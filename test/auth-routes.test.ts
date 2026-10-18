import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { createServer } from "../src/api/server.js";
import { openDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrations.js";
import { EventBus } from "../src/lib/bus.js";
import { UserRepository } from "../src/users/repository.js";
import { SessionStore } from "../src/users/sessions.js";
import { UserService } from "../src/users/service.js";
import type { AppConfig } from "../src/config.js";
import type { MetricsStore } from "../src/metrics/store.js";
import type { ServiceManager } from "../src/services/manager.js";
import type { UpdateService } from "../src/update/service.js";
import type { LoginResponse, PublicUser, SystemInfo } from "../src/types.js";

/* The routes under test do not care what the machine is doing, and the real
   samplers, service manager and update runner would each need the host to exist. */
const stubServices = { list: () => [], get: () => undefined } as unknown as ServiceManager;
const stubStore = { latest: () => null, count: () => 0, history: () => [] } as unknown as MetricsStore;
const stubUpdates = {
  status: () => ({}),
  check: async () => ({}),
  apply: async () => ({ ok: true, message: "", status: {}, httpStatus: 202 }),
  readLog: async () => ({ id: "update", logPath: "", lines: [], truncated: false }),
} as unknown as UpdateService;

const HOUR_MS = 3_600_000;
const PASSWORD = "long enough password";
const API_TOKEN = "shared-break-glass-token";

interface TestApp {
  app: FastifyInstance;
  users: UserService;
  sessions: SessionStore;
  cleanup: () => Promise<void>;
}

async function testApp(apiToken = ""): Promise<TestApp> {
  const dir = mkdtempSync(path.join(tmpdir(), "rc-auth-routes-"));
  const databasePath = path.join(dir, "remotecontrol.db");
  const db = openDatabase(databasePath);
  runMigrations(db);
  const sessions = new SessionStore(HOUR_MS, db);
  const users = new UserService(new UserRepository(db), sessions);

  const config = {
    rootDir: dir,
    logDir: path.join(dir, "logs"),
    server: { host: "127.0.0.1", port: 0, publicUrl: null },
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
    systemInfo: { hostname: "test-host" } as SystemInfo,
    startedAt: Date.now(),
  });

  return {
    app,
    users,
    sessions,
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

async function bootstrapAdmin(app: TestApp): Promise<LoginResponse> {
  const response = await request(app.app, "POST", "/api/auth/bootstrap", undefined, {
    login: "admin",
    password: PASSWORD,
  });
  assert.equal(response.statusCode, 201, response.body);
  const body = response.json() as LoginResponse;
  return body;
}

describe("auth routes", () => {
  it("leaves /api/health open and everything else closed until a session exists", async () => {
    const fixture = await testApp();
    try {
      const health = await request(fixture.app, "GET", "/api/health");
      assert.equal(health.statusCode, 200);

      const services = await request(fixture.app, "GET", "/api/services");
      assert.equal(services.statusCode, 401);
      assert.deepEqual(services.json(), { error: "unauthorized" });

      const status = await request(fixture.app, "GET", "/api/auth/status");
      assert.equal(status.statusCode, 200);
      assert.deepEqual(status.json(), { needsBootstrap: true });
    } finally {
      await fixture.cleanup();
    }
  });

  it("creates the first admin, then refuses to do it again", async () => {
    const fixture = await testApp();
    try {
      const weak = await request(fixture.app, "POST", "/api/auth/bootstrap", undefined, {
        login: "admin",
        password: "short",
      });
      assert.equal(weak.statusCode, 400);

      const badLogin = await request(fixture.app, "POST", "/api/auth/bootstrap", undefined, {
        login: "Admin One",
        password: PASSWORD,
      });
      assert.equal(badLogin.statusCode, 400);

      const created = await bootstrapAdmin(fixture);
      assert.equal(created.user.role, "admin");
      assert.ok(created.token.length >= 32);

      const again = await request(fixture.app, "POST", "/api/auth/bootstrap", undefined, {
        login: "someone",
        password: PASSWORD,
      });
      assert.equal(again.statusCode, 409);

      const status = await request(fixture.app, "GET", "/api/auth/status");
      assert.deepEqual(status.json(), { needsBootstrap: false });
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects a bad password and accepts the right one", async () => {
    const fixture = await testApp();
    try {
      await bootstrapAdmin(fixture);

      const wrong = await request(fixture.app, "POST", "/api/auth/login", undefined, {
        login: "admin",
        password: "wrong wrong wrong",
      });
      assert.equal(wrong.statusCode, 401);
      assert.deepEqual(wrong.json(), { error: "invalid login or password" });

      const right = await request(fixture.app, "POST", "/api/auth/login", undefined, {
        login: "admin",
        password: PASSWORD,
      });
      assert.equal(right.statusCode, 200);
      assert.equal((right.json() as LoginResponse).user.login, "admin");
    } finally {
      await fixture.cleanup();
    }
  });

  it("tells a signed-in caller who they are and what they may do", async () => {
    const fixture = await testApp();
    try {
      const created = await bootstrapAdmin(fixture);

      const anonymous = await request(fixture.app, "GET", "/api/auth/session");
      assert.equal(anonymous.statusCode, 401);

      const session = await request(fixture.app, "GET", "/api/auth/session", created.token);
      assert.equal(session.statusCode, 200);
      const body = session.json() as { user: PublicUser; permissions: string[] };
      assert.equal(body.user.login, "admin");
      assert.equal(body.user.role, "admin");
      assert.ok(body.permissions.includes("users:manage"));
    } finally {
      await fixture.cleanup();
    }
  });

  it("ends a session at logout", async () => {
    const fixture = await testApp();
    try {
      const created = await bootstrapAdmin(fixture);
      const loggedOut = await request(fixture.app, "POST", "/api/auth/logout", created.token);
      assert.equal(loggedOut.statusCode, 200);

      const session = await request(fixture.app, "GET", "/api/auth/session", created.token);
      assert.equal(session.statusCode, 401);
    } finally {
      await fixture.cleanup();
    }
  });
});

describe("permission gates", () => {
  it("lets a guest look at services but nothing else", async () => {
    const fixture = await testApp();
    try {
      const admin = await bootstrapAdmin(fixture);
      const created = await request(fixture.app, "POST", "/api/users", admin.token, {
        login: "viewer",
        password: PASSWORD,
        role: "guest",
      });
      assert.equal(created.statusCode, 201);

      const guest = await request(fixture.app, "POST", "/api/auth/login", undefined, {
        login: "viewer",
        password: PASSWORD,
      });
      assert.equal(guest.statusCode, 200);
      const token = (guest.json() as LoginResponse).token;

      assert.equal((await request(fixture.app, "GET", "/api/services", token)).statusCode, 200);
      assert.equal((await request(fixture.app, "GET", "/api/metrics/latest", token)).statusCode, 403);
      assert.equal((await request(fixture.app, "GET", "/api/update/status", token)).statusCode, 403);
      assert.equal((await request(fixture.app, "POST", "/api/update/apply", token, {})).statusCode, 403);
      assert.equal((await request(fixture.app, "GET", "/api/users", token)).statusCode, 403);
      assert.equal((await request(fixture.app, "POST", "/api/services/docker/start", token)).statusCode, 403);
    } finally {
      await fixture.cleanup();
    }
  });

  it("lets a manager run services and watch metrics, but not manage accounts or apply updates", async () => {
    const fixture = await testApp();
    try {
      const admin = await bootstrapAdmin(fixture);
      await request(fixture.app, "POST", "/api/users", admin.token, {
        login: "operator",
        password: PASSWORD,
        role: "manager",
      });
      const login = await request(fixture.app, "POST", "/api/auth/login", undefined, {
        login: "operator",
        password: PASSWORD,
      });
      const token = (login.json() as LoginResponse).token;

      assert.equal((await request(fixture.app, "GET", "/api/metrics/latest", token)).statusCode, 200);
      assert.equal((await request(fixture.app, "GET", "/api/update/status", token)).statusCode, 200);
      assert.equal((await request(fixture.app, "GET", "/api/users", token)).statusCode, 403);
      assert.equal((await request(fixture.app, "POST", "/api/update/apply", token, {})).statusCode, 403);
    } finally {
      await fixture.cleanup();
    }
  });

  it("keeps the shared API token working as a break-glass admin credential", async () => {
    const fixture = await testApp(API_TOKEN);
    try {
      const status = await request(fixture.app, "GET", "/api/auth/status");
      assert.deepEqual(status.json(), { needsBootstrap: true });

      const users = await request(fixture.app, "GET", "/api/users", API_TOKEN);
      assert.equal(users.statusCode, 200);
      assert.deepEqual(users.json(), { users: [] });

      const session = await request(fixture.app, "GET", "/api/auth/session", API_TOKEN);
      assert.equal(session.statusCode, 200);
      assert.equal((session.json() as { user: PublicUser }).user.login, "api");

      const wrong = await request(fixture.app, "GET", "/api/users", "not-the-token");
      assert.equal(wrong.statusCode, 401);
    } finally {
      await fixture.cleanup();
    }
  });
});

describe("user routes", () => {
  it("creates, edits and deletes accounts", async () => {
    const fixture = await testApp();
    try {
      const admin = await bootstrapAdmin(fixture);

      const created = await request(fixture.app, "POST", "/api/users", admin.token, {
        login: "viewer",
        password: PASSWORD,
        role: "guest",
      });
      assert.equal(created.statusCode, 201);
      const viewer = created.json() as PublicUser;

      const renamed = await request(fixture.app, "PATCH", `/api/users/${viewer.id}`, admin.token, {
        login: "watcher",
        role: "manager",
      });
      assert.equal(renamed.statusCode, 200);
      assert.equal((renamed.json() as PublicUser).login, "watcher");
      assert.equal((renamed.json() as PublicUser).role, "manager");

      const empty = await request(fixture.app, "PATCH", `/api/users/${viewer.id}`, admin.token, {});
      assert.equal(empty.statusCode, 400);

      const missing = await request(fixture.app, "PATCH", "/api/users/9999", admin.token, { role: "guest" });
      assert.equal(missing.statusCode, 404);

      const removed = await request(fixture.app, "DELETE", `/api/users/${viewer.id}`, admin.token);
      assert.equal(removed.statusCode, 204);
      const again = await request(fixture.app, "DELETE", `/api/users/${viewer.id}`, admin.token);
      assert.equal(again.statusCode, 404);
    } finally {
      await fixture.cleanup();
    }
  });

  it("refuses to leave the installation without an admin, or to delete yourself", async () => {
    const fixture = await testApp();
    try {
      const admin = await bootstrapAdmin(fixture);
      const session = await request(fixture.app, "GET", "/api/auth/session", admin.token);
      const adminId = (session.json() as { user: PublicUser }).user.id;

      const demote = await request(fixture.app, "PATCH", `/api/users/${adminId}`, admin.token, { role: "guest" });
      assert.equal(demote.statusCode, 409);

      const selfDelete = await request(fixture.app, "DELETE", `/api/users/${adminId}`, admin.token);
      assert.equal(selfDelete.statusCode, 409);
      assert.equal(fixture.users.list().length, 1);
    } finally {
      await fixture.cleanup();
    }
  });

  it("stops a token working when the role behind it changes", async () => {
    const fixture = await testApp();
    try {
      const admin = await bootstrapAdmin(fixture);
      const created = await request(fixture.app, "POST", "/api/users", admin.token, {
        login: "viewer",
        password: PASSWORD,
        role: "guest",
      });
      const viewer = created.json() as PublicUser;
      const login = await request(fixture.app, "POST", "/api/auth/login", undefined, {
        login: "viewer",
        password: PASSWORD,
      });
      const token = (login.json() as LoginResponse).token;

      assert.equal((await request(fixture.app, "GET", "/api/services", token)).statusCode, 200);
      const changed = await request(fixture.app, "PATCH", `/api/users/${viewer.id}`, admin.token, { role: "admin" });
      assert.equal(changed.statusCode, 200);
      assert.equal((await request(fixture.app, "GET", "/api/services", token)).statusCode, 401);
    } finally {
      await fixture.cleanup();
    }
  });
});
