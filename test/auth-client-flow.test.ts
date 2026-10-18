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
import type {
  LoginResponse,
  PublicUser,
  SessionResponse,
  SystemInfo,
  UsersResponse,
} from "../src/types.js";

/* The dashboard's own request sequence, in the order web/src/api.ts makes it. A route
   test that only looked at status codes would let a renamed field through, so this one
   reads the shapes the UI actually consumes. */
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
const ADMIN_PERMISSIONS = [
  "services:view",
  "services:control",
  "services:logs",
  "metrics:view",
  "update:view",
  "update:apply",
  "users:manage",
];

interface Client {
  app: FastifyInstance;
  cleanup: () => Promise<void>;
}

async function connect(): Promise<Client> {
  const dir = mkdtempSync(path.join(tmpdir(), "rc-client-flow-"));
  const databasePath = path.join(dir, "remotecontrol.db");
  const db = openDatabase(databasePath);
  runMigrations(db);
  const sessions = new SessionStore(HOUR_MS, db);
  const config = {
    rootDir: dir,
    logDir: path.join(dir, "logs"),
    server: { host: "127.0.0.1", port: 0, publicUrl: null },
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
    users: new UserService(new UserRepository(db), sessions),
    sessions,
    systemInfo: { hostname: "test-host" } as SystemInfo,
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

function call(app: FastifyInstance, method: string, url: string, token?: string, body?: unknown) {
  const headers: Record<string, string> = token === undefined ? {} : { authorization: `Bearer ${token}` };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return app.inject({ method: method as "GET", url, headers, payload });
}

async function signInAsAdmin(client: Client): Promise<string> {
  const created = await call(client.app, "POST", "/api/auth/bootstrap", undefined, {
    login: "admin",
    password: PASSWORD,
  });
  return (created.json() as LoginResponse).token;
}

describe("the dashboard's sign-in flow", () => {
  it("asks whether accounts exist, creates the first one, and reads back what it may do", async () => {
    const client = await connect();
    try {
      const status = await call(client.app, "GET", "/api/auth/status");
      assert.equal(status.statusCode, 200);
      assert.deepEqual(status.json(), { needsBootstrap: true });

      const created = await call(client.app, "POST", "/api/auth/bootstrap", undefined, {
        login: "admin",
        password: PASSWORD,
      });
      assert.equal(created.statusCode, 201);
      const session = created.json() as LoginResponse;
      assert.equal(typeof session.token, "string");
      assert.ok(session.token.length >= 32, "the token has to be long enough to be unguessable");
      assert.ok(session.expiresAt > Date.now());
      assert.deepEqual(session.permissions, ADMIN_PERMISSIONS);

      /* What the hook does on the next page load, holding only the stored token. */
      const restored = await call(client.app, "GET", "/api/auth/session", session.token);
      assert.equal(restored.statusCode, 200);
      const view = restored.json() as SessionResponse;
      assert.equal(view.user.login, "admin");
      assert.equal(view.user.role, "admin");
      assert.deepEqual(view.permissions, ADMIN_PERMISSIONS);
      assert.ok(view.expiresAt > Date.now());

      const after = await call(client.app, "GET", "/api/auth/status");
      assert.deepEqual(after.json(), { needsBootstrap: false });
    } finally {
      await client.cleanup();
    }
  });

  it("runs the account editor's create, edit and delete, including the empty 204 the client must tolerate", async () => {
    const client = await connect();
    try {
      const token = await signInAsAdmin(client);

      const created = await call(client.app, "POST", "/api/users", token, {
        login: "viewer",
        password: PASSWORD,
        role: "guest",
      });
      assert.equal(created.statusCode, 201);
      const viewer = created.json() as PublicUser;
      assert.equal(
        "passwordHash" in (created.json() as Record<string, unknown>),
        false,
        "the client must never be handed a password hash",
      );

      const list = await call(client.app, "GET", "/api/users", token);
      assert.equal(list.statusCode, 200);
      assert.deepEqual((list.json() as UsersResponse).users.map((user) => user.login), ["admin", "viewer"]);

      const edited = await call(client.app, "PATCH", `/api/users/${viewer.id}`, token, { role: "manager" });
      assert.equal(edited.statusCode, 200);
      assert.equal((edited.json() as PublicUser).role, "manager");

      const removed = await call(client.app, "DELETE", `/api/users/${viewer.id}`, token);
      assert.equal(removed.statusCode, 204);
      assert.equal(removed.payload, "");
    } finally {
      await client.cleanup();
    }
  });

  it("signs the editor out too when it changes the account it is signed in with", async () => {
    const client = await connect();
    try {
      const adminToken = await signInAsAdmin(client);
      const adminId = ((await call(client.app, "GET", "/api/auth/session", adminToken)).json() as SessionResponse).user.id;

      const second = await call(client.app, "POST", "/api/users", adminToken, {
        login: "other",
        password: PASSWORD,
        role: "admin",
      });
      const otherId = (second.json() as PublicUser).id;

      /* Demoting yourself is allowed once a second admin exists, and it ends your session. */
      const demote = await call(client.app, "PATCH", `/api/users/${adminId}`, adminToken, { role: "manager" });
      assert.equal(demote.statusCode, 200);
      assert.equal((await call(client.app, "GET", "/api/auth/session", adminToken)).statusCode, 401);

      const otherLogin = await call(client.app, "POST", "/api/auth/login", undefined, {
        login: "other",
        password: PASSWORD,
      });
      const otherToken = (otherLogin.json() as LoginResponse).token;
      const restore = await call(client.app, "PATCH", `/api/users/${adminId}`, otherToken, { role: "admin" });
      assert.equal(restore.statusCode, 200);

      /* Changing your own password is the one edit that keeps the session you are using. */
      const own = await call(client.app, "PATCH", `/api/users/${otherId}`, otherToken, { password: `${PASSWORD} 2` });
      assert.equal(own.statusCode, 200);
      assert.equal((await call(client.app, "GET", "/api/auth/session", otherToken)).statusCode, 200);
    } finally {
      await client.cleanup();
    }
  });
});

