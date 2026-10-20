import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createServer } from "../src/api/server.js";
import { bearerOrTokenParam } from "../src/auth/middleware.js";
import { openDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrations.js";
import { EventBus } from "../src/lib/bus.js";
import { UnknownServiceError } from "../src/services/errors.js";
import { UserRepository } from "../src/users/repository.js";
import { SessionStore } from "../src/users/sessions.js";
import { UserService } from "../src/users/service.js";
import type { AppConfig } from "../src/config.js";
import type { MetricsStore } from "../src/metrics/store.js";
import type { ServiceManager } from "../src/services/manager.js";
import type { UpdateService } from "../src/update/service.js";
import type { LoginResponse, SystemInfo } from "../src/types.js";

/* The internals a failure may expose in the log but must never expose in a response. */
const INTERNAL_DETAIL = "sqlite disk I/O error at /var/lib/remotecontrol/remotecontrol.db";

const stubServices = {
  list: () => [],
  get: () => undefined,
  start: () => {
    throw new UnknownServiceError("nope");
  },
} as unknown as ServiceManager;

const stubStore = {
  latest: () => {
    throw new Error(INTERNAL_DETAIL);
  },
  count: () => 0,
  history: () => [],
} as unknown as MetricsStore;

const stubUpdates = {
  status: () => ({}),
  check: async () => ({}),
  reset: () => ({ phase: "unknown", canApply: false }),
  apply: async () => ({ ok: true, message: "", status: {}, httpStatus: 202 }),
  readLog: async () => ({ id: "update", logPath: "", lines: [], truncated: false }),
} as unknown as UpdateService;

const HOUR_MS = 3_600_000;
const PASSWORD = "long enough password";
const PUBLIC_URL = "https://dashboard.example.test";
const BREAK_GLASS_TOKEN = "break-glass-token-for-tests";

const SYSTEM_INFO: SystemInfo = {
  hostname: "test-host",
  kernel: "6.9.0-test",
  arch: "x64-linux",
  appVersion: "0.0.1",
  startedAt: 1000,
  uptimeSeconds: 42,
  cpuModel: "Test CPU",
  logicalCores: 4,
  memoryTotalBytes: 1024,
  gpuModel: null,
  vramTotalBytes: null,
};

interface TestApp {
  app: FastifyInstance;
  cleanup: () => Promise<void>;
}

async function testApp(apiToken = ""): Promise<TestApp> {
  const dir = mkdtempSync(path.join(tmpdir(), "rc-hardening-"));
  const databasePath = path.join(dir, "remotecontrol.db");
  const db = openDatabase(databasePath);
  runMigrations(db);
  const sessions = new SessionStore(HOUR_MS, db);
  const users = new UserService(new UserRepository(db), sessions);

  const config = {
    rootDir: dir,
    logDir: path.join(dir, "logs"),
    server: { host: "127.0.0.1", port: 8790, publicUrl: PUBLIC_URL },
    auth: { apiToken, sessionTtlMs: HOUR_MS },
    storage: { dataDir: dir, databasePath },
    metrics: {
      sampleIntervalMs: 1000,
      retentionMinutes: 1,
      statusIntervalMs: 1000,
      cpu: { hwmonLabel: "test" },
      gpu: { cardPath: "", expectPciDevice: null, rocmSmiFallback: false, rocmSmiIntervalMs: 10_000 },
    },
    update: {
      enabled: false,
      remote: "origin",
      releasePattern: "^release_(\\d+)$",
      allowDirty: false,
      runInstall: false,
      runBuild: false,
      restartUnit: null,
      fetchTimeoutMs: 1000,
      autoCheckMinutes: 0,
    },
    services: [],
  } as AppConfig;

  const app = await createServer({
    config,
    bus: new EventBus(),
    store: stubStore,
    services: stubServices,
    updates: stubUpdates,
    users,
    sessions,
    systemInfo: SYSTEM_INFO,
    startedAt: Date.now(),
  });

  return {
    app,
    cleanup: async () => {
      await app.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function request(app: FastifyInstance, method: string, url: string, token?: string, body?: unknown) {
  const headers: Record<string, string> = token === undefined ? {} : { authorization: `Bearer ${token}` };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }
  return app.inject({
    method: method as "GET",
    url,
    headers,
    payload: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function bootstrapAdmin(app: FastifyInstance): Promise<LoginResponse> {
  const response = await request(app, "POST", "/api/auth/bootstrap", undefined, {
    login: "admin",
    password: PASSWORD,
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json() as LoginResponse;
}

async function guestToken(app: FastifyInstance, adminToken: string): Promise<string> {
  const created = await request(app, "POST", "/api/users", adminToken, {
    login: "viewer",
    password: PASSWORD,
    role: "guest",
  });
  assert.equal(created.statusCode, 201, created.body);
  const login = await request(app, "POST", "/api/auth/login", undefined, {
    login: "viewer",
    password: PASSWORD,
  });
  assert.equal(login.statusCode, 200, login.body);
  return (login.json() as LoginResponse).token;
}

describe("security headers", () => {
  it("sets them on API responses and on the HTML fallback", async () => {
    const fixture = await testApp();
    try {
      const responses = [
        await request(fixture.app, "GET", "/api/health"),
        await request(fixture.app, "GET", "/dashboard"),
      ];

      for (const response of responses) {
        assert.equal(response.headers["x-content-type-options"], "nosniff");
        assert.equal(response.headers["x-frame-options"], "DENY");
        assert.equal(response.headers["referrer-policy"], "no-referrer");
      }

      const csp = responses[0]?.headers["content-security-policy"] ?? "";
      for (const directive of [
        "default-src 'self'",
        "script-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
      ]) {
        assert.ok(csp.includes(directive), `missing CSP directive: ${directive}`);
      }
    } finally {
      await fixture.cleanup();
    }
  });

  it("keeps the health probe free of host details", async () => {
    const fixture = await testApp();
    try {
      const health = await request(fixture.app, "GET", "/api/health");
      assert.equal(health.statusCode, 200);
      assert.deepEqual(health.json(), { ok: true });
    } finally {
      await fixture.cleanup();
    }
  });
});

describe("token placement", () => {
  it("reads a query token only when the route is allowed to", () => {
    const queryOnly = { headers: {}, query: { token: "abc" } } as unknown as FastifyRequest;
    assert.equal(bearerOrTokenParam(queryOnly), null);
    assert.equal(bearerOrTokenParam(queryOnly, true), "abc");

    const header = { headers: { authorization: "Bearer abc" }, query: {} } as unknown as FastifyRequest;
    assert.equal(bearerOrTokenParam(header), "abc");
  });

  it("refuses a session carried in the query string on a normal API route", async () => {
    const fixture = await testApp();
    try {
      const admin = await bootstrapAdmin(fixture.app);

      const viaQuery = await request(fixture.app, "GET", `/api/services?token=${admin.token}`);
      assert.equal(viaQuery.statusCode, 401);

      const viaHeader = await request(fixture.app, "GET", "/api/services", admin.token);
      assert.equal(viaHeader.statusCode, 200);

      const events = await request(fixture.app, "GET", "/api/events");
      assert.equal(events.statusCode, 401);
    } finally {
      await fixture.cleanup();
    }
  });

  it("still accepts the query token on the event stream, and answers it with the headers", async () => {
    const fixture = await testApp(BREAK_GLASS_TOKEN);
    try {
      const address = await fixture.app.listen({ port: 0, host: "127.0.0.1" });
      const controller = new AbortController();
      const stream = await fetch(`${address}/api/events?token=${BREAK_GLASS_TOKEN}`, {
        signal: controller.signal,
      });
      try {
        assert.equal(stream.status, 200);
        assert.equal(stream.headers.get("content-type"), "text/event-stream");
        assert.equal(stream.headers.get("x-content-type-options"), "nosniff");
        assert.equal(stream.headers.get("x-frame-options"), "DENY");
      } finally {
        await stream.body?.cancel().catch(() => undefined);
        controller.abort();
      }
    } finally {
      await fixture.cleanup();
    }
  });
});

describe("system report", () => {
  it("is limited to roles that may watch the machine, and without server internals", async () => {
    const fixture = await testApp();
    try {
      const admin = await bootstrapAdmin(fixture.app);
      const guest = await guestToken(fixture.app, admin.token);

      const anonymous = await request(fixture.app, "GET", "/api/system");
      assert.equal(anonymous.statusCode, 401);

      const refused = await request(fixture.app, "GET", "/api/system", guest);
      assert.equal(refused.statusCode, 403);

      const allowed = await request(fixture.app, "GET", "/api/system", admin.token);
      assert.equal(allowed.statusCode, 200);
      const body = allowed.json() as SystemInfo & { server: Record<string, unknown> };
      assert.equal(body.hostname, "test-host");
      assert.deepEqual(body.server, { publicUrl: PUBLIC_URL });
      for (const hidden of ["host", "port", "configPath"]) {
        assert.ok(!(hidden in body.server), `server.${hidden} should not be exposed`);
      }
    } finally {
      await fixture.cleanup();
    }
  });
});

describe("error responses", () => {
  it("answers a server-side failure with a request id instead of the internals", async () => {
    const fixture = await testApp();
    try {
      const admin = await bootstrapAdmin(fixture.app);
      const failed = await request(fixture.app, "GET", "/api/metrics/latest", admin.token);

      assert.equal(failed.statusCode, 500);
      const body = failed.json() as { error: string; requestId: string };
      assert.equal(body.error, "request failed");
      assert.match(body.requestId, /^[0-9a-f-]{36}$/);
      assert.ok(!failed.body.includes("sqlite"), "the storage error must not reach the client");
      assert.ok(!failed.body.includes("/var/lib"), "paths must not reach the client");
    } finally {
      await fixture.cleanup();
    }
  });

  it("maps an unknown service to a plain 404", async () => {
    const fixture = await testApp();
    try {
      const admin = await bootstrapAdmin(fixture.app);
      const started = await request(fixture.app, "POST", "/api/services/nope/start", admin.token);
      assert.equal(started.statusCode, 404);
      assert.deepEqual(started.json(), { error: "unknown service" });
    } finally {
      await fixture.cleanup();
    }
  });

  it("keeps validation and account errors readable", async () => {
    const fixture = await testApp();
    try {
      const admin = await bootstrapAdmin(fixture.app);

      const invalid = await request(fixture.app, "POST", "/api/users", admin.token, {
        login: "Admin One",
        password: PASSWORD,
        role: "guest",
      });
      assert.equal(invalid.statusCode, 400);
      assert.deepEqual(invalid.json(), {
        error: "login must be 2-32 lowercase letters, digits, dots, dashes or underscores",
      });

      const duplicate = await request(fixture.app, "POST", "/api/users", admin.token, {
        login: "admin",
        password: PASSWORD,
        role: "guest",
      });
      assert.equal(duplicate.statusCode, 409);
      assert.deepEqual(duplicate.json(), { error: "login 'admin' is already taken" });
    } finally {
      await fixture.cleanup();
    }
  });
});
