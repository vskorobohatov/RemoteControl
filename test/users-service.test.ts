import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { openDatabase, type Db } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrations.js";
import { LastAdminError, SelfDeleteError } from "../src/users/errors.js";
import { UserRepository } from "../src/users/repository.js";
import { SessionStore } from "../src/users/sessions.js";
import { UserService } from "../src/users/service.js";

const HOUR_MS = 3_600_000;
const PASSWORD = "long enough password";

interface Fixture {
  db: Db;
  service: UserService;
  sessions: SessionStore;
  cleanup: () => void;
}

function fixture(ttlMs: number = HOUR_MS): Fixture {
  const dir = mkdtempSync(path.join(tmpdir(), "rc-users-service-"));
  const db = openDatabase(path.join(dir, "remotecontrol.db"));
  runMigrations(db);
  const sessions = new SessionStore(ttlMs, db);
  return {
    db,
    sessions,
    service: new UserService(new UserRepository(db), sessions),
    cleanup: () => {
      try {
        db.close();
      } catch {
        /* already closed */
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe("UserService bootstrap", () => {
  it("creates the first admin and hands out a session with every permission", () => {
    const { service, cleanup } = fixture();
    try {
      assert.equal(service.needsBootstrap(), true);
      const result = service.bootstrap("admin", PASSWORD);

      assert.ok(result);
      assert.equal(result.user.role, "admin");
      assert.equal(result.user.login, "admin");
      assert.ok(result.token.length >= 32);
      assert.deepEqual(result.permissions, [
        "services:view",
        "services:control",
        "services:logs",
        "metrics:view",
        "update:view",
        "update:apply",
        "users:manage",
      ]);
      assert.equal(service.needsBootstrap(), false);
    } finally {
      cleanup();
    }
  });

  it("only ever runs once, so a second visitor cannot mint another admin", () => {
    const { service, cleanup } = fixture();
    try {
      service.bootstrap("admin", PASSWORD);
      assert.equal(service.bootstrap("someone", PASSWORD), null);
      assert.equal(service.list().length, 1);
    } finally {
      cleanup();
    }
  });
});

describe("UserService login", () => {
  it("accepts the right password and records when it happened", () => {
    const { service, cleanup } = fixture();
    try {
      const created = service.bootstrap("admin", PASSWORD);
      assert.ok(created);
      assert.equal(created.user.lastLoginAt, null);

      const again = service.login("admin", PASSWORD);
      assert.ok(again);
      assert.equal(again.user.id, created.user.id);
      assert.notEqual(again.user.lastLoginAt, null);
    } finally {
      cleanup();
    }
  });

  it("gives the same answer for a wrong password and a login that does not exist", () => {
    const { service, cleanup } = fixture();
    try {
      service.bootstrap("admin", PASSWORD);
      assert.equal(service.login("admin", "wrong wrong wrong"), null);
      assert.equal(service.login("nobody", PASSWORD), null);
    } finally {
      cleanup();
    }
  });

  it("stops accepting attempts for a login that keeps failing", () => {
    const { service, cleanup } = fixture();
    try {
      service.bootstrap("admin", PASSWORD);
      service.create({ login: "operator", password: PASSWORD, role: "manager" });
      for (let attempt = 0; attempt < 10; attempt += 1) {
        assert.equal(service.login("admin", "wrong wrong wrong"), null, `attempt ${attempt}`);
      }
      assert.equal(service.login("admin", PASSWORD), null);
      /* A different login is not affected. */
      assert.notEqual(service.login("operator", PASSWORD), null);
    } finally {
      cleanup();
    }
  });

  it("issues a separate token for every login", () => {
    const { service, sessions, cleanup } = fixture();
    try {
      service.bootstrap("admin", PASSWORD);
      const first = service.login("admin", PASSWORD);
      const second = service.login("admin", PASSWORD);

      assert.ok(first && second);
      assert.notEqual(first.token, second.token);
      assert.notEqual(sessions.read(first.token), null);
      assert.notEqual(sessions.read(second.token), null);
    } finally {
      cleanup();
    }
  });
});

describe("UserService accounts", () => {
  it("creates accounts in any role and lists them without password hashes", () => {
    const { service, cleanup } = fixture();
    try {
      service.bootstrap("admin", PASSWORD);
      service.create({ login: "operator", password: PASSWORD, role: "manager" });
      service.create({ login: "viewer", password: PASSWORD, role: "guest" });

      const users = service.list();
      assert.deepEqual(
        users.map((user) => [user.login, user.role]),
        [
          ["admin", "admin"],
          ["operator", "manager"],
          ["viewer", "guest"],
        ],
      );
      assert.deepEqual(Object.keys(users[0] ?? {}).sort(), [
        "createdAt",
        "id",
        "lastLoginAt",
        "login",
        "role",
        "updatedAt",
      ]);
    } finally {
      cleanup();
    }
  });

  it("refuses a login that is already taken", () => {
    const { service, cleanup } = fixture();
    try {
      service.bootstrap("admin", PASSWORD);
      assert.throws(() => service.create({ login: "admin", password: PASSWORD, role: "guest" }), Error);
      assert.equal(service.list().length, 1);
    } finally {
      cleanup();
    }
  });

  it("ends a session when the role behind it changes", () => {
    const { service, sessions, cleanup } = fixture();
    try {
      service.bootstrap("admin", PASSWORD);
      service.create({ login: "viewer", password: PASSWORD, role: "guest" });
      const session = service.login("viewer", PASSWORD);
      assert.ok(session);
      assert.deepEqual(session.permissions, ["services:view"]);

      const updated = service.update(session.user.id, { role: "manager" }, 1);
      assert.equal(updated?.role, "manager");
      assert.equal(sessions.read(session.token), null);
    } finally {
      cleanup();
    }
  });

  it("keeps your own session when you change your own password", () => {
    const { service, sessions, cleanup } = fixture();
    try {
      const created = service.bootstrap("admin", PASSWORD);
      assert.ok(created);
      assert.notEqual(
        service.update(created.user.id, { password: "another long password" }, created.user.id),
        null,
      );
      assert.notEqual(sessions.read(created.token), null);
    } finally {
      cleanup();
    }
  });

  it("signs an account out when someone else resets its password", () => {
    const { service, sessions, cleanup } = fixture();
    try {
      const admin = service.bootstrap("admin", PASSWORD);
      assert.ok(admin);
      service.create({ login: "viewer", password: PASSWORD, role: "guest" });
      const viewer = service.login("viewer", PASSWORD);
      assert.ok(viewer);

      assert.notEqual(service.update(viewer.user.id, { password: "another long password" }, admin.user.id), null);
      assert.equal(sessions.read(viewer.token), null);
    } finally {
      cleanup();
    }
  });

  it("never leaves the installation without an admin", () => {
    const { service, cleanup } = fixture();
    try {
      const admin = service.bootstrap("admin", PASSWORD);
      assert.ok(admin);
      assert.throws(() => service.update(admin.user.id, { role: "manager" }, admin.user.id), LastAdminError);
      assert.throws(() => service.remove(admin.user.id, 99), LastAdminError);
      assert.equal(service.get(admin.user.id)?.role, "admin");

      service.create({ login: "second", password: PASSWORD, role: "admin" });
      assert.notEqual(service.update(admin.user.id, { role: "manager" }, admin.user.id), null);
      /* Now that another admin exists, this account is just another account. */
      assert.equal(service.remove(admin.user.id, 99), true);
    } finally {
      cleanup();
    }
  });

  it("refuses to delete the account that is asking, and reports an unknown one", () => {
    const { service, cleanup } = fixture();
    try {
      const admin = service.bootstrap("admin", PASSWORD);
      assert.ok(admin);
      service.create({ login: "second", password: PASSWORD, role: "admin" });
      assert.throws(() => service.remove(admin.user.id, admin.user.id), SelfDeleteError);
      assert.equal(service.remove(999, admin.user.id), false);
      assert.equal(service.list().length, 2);
    } finally {
      cleanup();
    }
  });
});

describe("UserService sessions", () => {
  it("rebuilds what an already-authenticated request may do", () => {
    const { service, cleanup } = fixture();
    try {
      service.bootstrap("admin", PASSWORD);
      service.create({ login: "viewer", password: PASSWORD, role: "guest" });
      const viewer = service.list().find((user) => user.login === "viewer");
      assert.ok(viewer);

      const view = service.sessionFor(viewer.id, 123);
      assert.ok(view);
      assert.equal(view.user.login, "viewer");
      assert.equal(view.expiresAt, 123);
      assert.deepEqual(view.permissions, ["services:view"]);
      assert.equal(service.sessionFor(999, 123), null);
    } finally {
      cleanup();
    }
  });
});
