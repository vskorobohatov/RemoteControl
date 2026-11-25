import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { createServer } from "../src/api/server.js";
import { parseCapability, type HostControl } from "../src/host/power.js";
import { openDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrations.js";
import { EventBus } from "../src/lib/bus.js";
import { SessionStore } from "../src/users/sessions.js";
import { UserRepository } from "../src/users/repository.js";
import { UserService } from "../src/users/service.js";
import type { AppConfig } from "../src/config.js";
import type { MetricsStore } from "../src/metrics/store.js";
import type { ServiceManager } from "../src/services/manager.js";
import type { UpdateService } from "../src/update/service.js";
import type { LoginResponse, SystemInfo } from "../src/types.js";

const HOUR_MS = 3_600_000;
const PASSWORD = "long enough password";

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

const stubServices = { list: () => [], get: () => undefined, storedKeys: () => [] } as unknown as ServiceManager;
const stubStore = { latest: () => null, count: () => 0, history: () => [] } as unknown as MetricsStore;
const stubUpdates = {
  status: () => ({}),
  check: async () => ({}),
  reset: () => ({ phase: "unknown", canApply: false }),
  apply: async () => ({ ok: true, message: "", status: {}, httpStatus: 202 }),
  readLog: async () => ({ id: "update", logPath: "", lines: [], truncated: false }),
} as unknown as UpdateService;

/** Records every power call a route made, so a refusal can be proven to stop short of one. */
interface PowerProbe {
  calls: string[];
  granted: boolean;
}

function recordingHost(probe: PowerProbe): HostControl {
  const act = (name: string) => async () => {
    probe.calls.push(name);
    return probe.granted
      ? { ok: true, httpStatus: 202, message: `${name} requested` }
      : { ok: false, httpStatus: 409, message: `logind will not ${name} this host for this session (challenge)` };
  };
  return {
    status: async () => {
      probe.calls.push("status");
      return {
        canShutdown: probe.granted,
        canRestart: probe.granted,
        detail: probe.granted ? "logind grants this session both power off and reboot" : "logind refuses this session",
      };
    },
    shutdown: act("shut down"),
    restart: act("reboot"),
  } as unknown as HostControl;
}

interface TestApp {
  app: FastifyInstance;
  probe: PowerProbe;
  cleanup: () => Promise<void>;
}

async function testApp(granted: boolean): Promise<TestApp> {
  const dir = mkdtempSync(path.join(tmpdir(), "rc-host-"));
  const databasePath = path.join(dir, "remotecontrol.db");
  const db = openDatabase(databasePath);
  runMigrations(db);
  const sessions = new SessionStore(HOUR_MS, db);
  const users = new UserService(new UserRepository(db), sessions);
  const probe: PowerProbe = { calls: [], granted };

  const config = {
    rootDir: dir,
    logDir: path.join(dir, "logs"),
    server: { host: "127.0.0.1", port: 8791, publicUrl: "https://dashboard.example.test" },
    auth: { apiToken: "", sessionTtlMs: HOUR_MS },
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
    host: recordingHost(probe),
    users,
    sessions,
    systemInfo: SYSTEM_INFO,
    startedAt: Date.now(),
  });

  return {
    app,
    probe,
    cleanup: async () => {
      await app.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function request(app: FastifyInstance, method: string, url: string, token?: string) {
  return app.inject({
    method: method as "GET",
    url,
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });
}

function postJson(app: FastifyInstance, url: string, body: unknown, token?: string) {
  return app.inject({
    method: "POST",
    url,
    headers: {
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      "content-type": "application/json",
    },
    payload: JSON.stringify(body),
  });
}

/** The first admin every case bootstraps, signed back in as. */
async function adminToken(app: FastifyInstance): Promise<string> {
  const boot = await postJson(app, "/api/auth/bootstrap", { login: "admin", password: PASSWORD });
  assert.equal(boot.statusCode, 201, boot.body);
  const signIn = await postJson(app, "/api/auth/login", { login: "admin", password: PASSWORD });
  assert.equal(signIn.statusCode, 200, signIn.body);
  return (signIn.json() as LoginResponse).token;
}

/** A second account of the given role, signed in - what a refused role has to hold to be refused. */
async function tokenFor(app: FastifyInstance, admin: string, login: string, role: string): Promise<string> {
  const created = await postJson(app, "/api/users", { login, password: PASSWORD, role }, admin);
  assert.equal(created.statusCode, 201, created.body);
  const signIn = await postJson(app, "/api/auth/login", { login, password: PASSWORD });
  assert.equal(signIn.statusCode, 200, signIn.body);
  return (signIn.json() as LoginResponse).token;
}

describe("logind capability parsing", () => {
  it("reads the word busctl answers", () => {
    assert.equal(parseCapability('s "yes"\n'), "yes");
    assert.equal(parseCapability('s "challenge"\n'), "challenge");
    assert.equal(parseCapability('s "auth"\n'), "auth");
    assert.equal(parseCapability('s "no"\n'), "no");
  });

  it("treats anything else as unknown rather than as permission", () => {
    assert.equal(parseCapability(""), "unknown");
    assert.equal(parseCapability("Bus not connected."), "unknown");
    assert.equal(parseCapability("b true"), "unknown");
  });
});

describe("host power routes", () => {
  it("refuses an anonymous caller before the host is asked anything", async () => {
    const fixture = await testApp(true);
    try {
      assert.equal((await request(fixture.app, "GET", "/api/host/power")).statusCode, 401);
      assert.equal((await request(fixture.app, "POST", "/api/host/shutdown")).statusCode, 401);
      assert.equal((await request(fixture.app, "POST", "/api/host/restart")).statusCode, 401);
      assert.deepEqual(fixture.probe.calls, []);
    } finally {
      await fixture.cleanup();
    }
  });

  it("refuses a manager and a guest without reaching the host", async () => {
    const fixture = await testApp(true);
    try {
      const admin = await adminToken(fixture.app);
      for (const [login, role] of [
        ["watcher", "manager"],
        ["viewer", "guest"],
      ] as const) {
        const token = await tokenFor(fixture.app, admin, login, role);
        for (const [method, url] of [
          ["POST", "/api/host/shutdown"],
          ["POST", "/api/host/restart"],
          ["GET", "/api/host/power"],
        ] as const) {
          const response = await request(fixture.app, method, url, token);
          assert.equal(response.statusCode, 403, `${role} ${method} ${url}`);
          assert.equal(JSON.parse(response.body).detail, `role '${role}' may not host:control`);
        }
      }
      assert.deepEqual(fixture.probe.calls, []);
    } finally {
      await fixture.cleanup();
    }
  });

  it("tells an admin what logind will let this session do", async () => {
    const fixture = await testApp(true);
    try {
      const admin = await adminToken(fixture.app);
      const status = await request(fixture.app, "GET", "/api/host/power", admin);
      assert.equal(status.statusCode, 200, status.body);
      assert.deepEqual(status.json(), {
        canShutdown: true,
        canRestart: true,
        detail: "logind grants this session both power off and reboot",
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("carries an admin's shutdown and restart to the host", async () => {
    const fixture = await testApp(true);
    try {
      const admin = await adminToken(fixture.app);
      const shutdown = await request(fixture.app, "POST", "/api/host/shutdown", admin);
      assert.equal(shutdown.statusCode, 202, shutdown.body);
      assert.equal(shutdown.json().message, "shut down requested");
      const restart = await request(fixture.app, "POST", "/api/host/restart", admin);
      assert.equal(restart.statusCode, 202, restart.body);
      assert.deepEqual(fixture.probe.calls, ["shut down", "reboot"]);
    } finally {
      await fixture.cleanup();
    }
  });

  it("answers a session logind refuses with the reason, not a silent failure", async () => {
    const fixture = await testApp(false);
    try {
      const admin = await adminToken(fixture.app);
      const response = await request(fixture.app, "POST", "/api/host/restart", admin);
      assert.equal(response.statusCode, 409, response.body);
      assert.match(response.json().error, /logind will not reboot this host for this session \(challenge\)/);
    } finally {
      await fixture.cleanup();
    }
  });
});
