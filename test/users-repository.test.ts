import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { openDatabase, type Db } from "../src/db/connection.js";
import { MIGRATIONS, runMigrations } from "../src/db/migrations.js";
import { DuplicateLoginError } from "../src/users/errors.js";
import { hashPassword } from "../src/users/passwords.js";
import { UserRepository } from "../src/users/repository.js";
import { SessionStore, hashToken } from "../src/users/sessions.js";

const HOUR_MS = 3_600_000;

interface TempDatabase {
  db: Db;
  file: string;
  reopen: () => Db;
  cleanup: () => void;
}

function tempDatabase(): TempDatabase {
  const dir = mkdtempSync(path.join(tmpdir(), "rc-users-db-"));
  const file = path.join(dir, "remotecontrol.db");
  const db = openDatabase(file);
  return {
    db,
    file,
    reopen: () => openDatabase(file),
    cleanup: () => {
      try {
        db.close();
      } catch {
        /* already closed by the test itself */
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function prepared(): TempDatabase & { users: UserRepository } {
  const temp = tempDatabase();
  runMigrations(temp.db);
  return { ...temp, users: new UserRepository(temp.db) };
}

function countRows(db: Db, table: string): number {
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

describe("runMigrations", () => {
  it("applies every pending migration once and reports what it did", () => {
    const temp = tempDatabase();
    try {
      const first = runMigrations(temp.db);
      assert.deepEqual(
        first.map((migration) => migration.id),
        MIGRATIONS.map((migration) => migration.id),
      );

      assert.deepEqual(runMigrations(temp.db), []);

      const rows = temp.db.prepare("SELECT id, name FROM schema_migrations ORDER BY id").all() as {
        id: number;
        name: string;
      }[];
      assert.deepEqual(
        rows.map((row) => row.name),
        MIGRATIONS.map((migration) => migration.name),
      );
    } finally {
      temp.cleanup();
    }
  });

  it("survives reopening the same file, which is what a restart does", () => {
    const temp = tempDatabase();
    try {
      runMigrations(temp.db);
      temp.db.prepare("INSERT INTO users (login, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
        "admin",
        "hash",
        "admin",
        1,
        1,
      );
      temp.db.close();

      const reopened = temp.reopen();
      try {
        assert.deepEqual(runMigrations(reopened), []);
        const row = reopened.prepare("SELECT login FROM users WHERE id = 1").get() as { login: string };
        assert.equal(row.login, "admin");
      } finally {
        reopened.close();
      }
    } finally {
      temp.cleanup();
    }
  });
});

describe("UserRepository", () => {
  it("creates, reads and lists users", () => {
    const { users, cleanup } = prepared();
    try {
      const admin = users.create({ login: "admin", passwordHash: hashPassword("hunter2 hunter2"), role: "admin" });
      users.create({ login: "viewer", passwordHash: hashPassword("hunter2 hunter2"), role: "guest" });

      assert.equal(admin.login, "admin");
      assert.equal(admin.role, "admin");
      assert.equal(typeof admin.createdAt, "number");
      assert.equal(users.count(), 2);
      assert.equal(users.countByRole("admin"), 1);
      assert.equal(users.countByRole("guest"), 1);
      assert.deepEqual(
        users.list().map((user) => user.login),
        ["admin", "viewer"],
      );
      assert.equal(users.get(admin.id)?.login, "admin");
      assert.equal(users.get(999), null);
    } finally {
      cleanup();
    }
  });

  it("refuses a duplicate login whatever the case", () => {
    const { users, cleanup } = prepared();
    try {
      users.create({ login: "admin", passwordHash: "hash", role: "admin" });
      assert.throws(() => users.create({ login: "ADMIN", passwordHash: "hash", role: "guest" }), DuplicateLoginError);
      assert.equal(users.count(), 1);
    } finally {
      cleanup();
    }
  });

  it("renames and re-roles a user", () => {
    const { users, cleanup } = prepared();
    try {
      const user = users.create({ login: "operator", passwordHash: "hash", role: "guest" });
      users.update(user.id, "operator.one", "manager");

      const changed = users.getByLogin("operator.one");
      assert.ok(changed);
      assert.equal(changed.id, user.id);
      assert.equal(changed.role, "manager");
      assert.equal(users.getByLogin("operator"), null);
    } finally {
      cleanup();
    }
  });

  it("rejects a rename that collides with another account", () => {
    const { users, cleanup } = prepared();
    try {
      users.create({ login: "admin", passwordHash: "hash", role: "admin" });
      const other = users.create({ login: "guest", passwordHash: "hash", role: "guest" });
      assert.throws(() => users.update(other.id, "admin", "guest"), DuplicateLoginError);
      assert.equal(users.getByLogin("guest")?.id, other.id);
    } finally {
      cleanup();
    }
  });

  it("records the last login", () => {
    const { users, cleanup } = prepared();
    try {
      const user = users.create({ login: "admin", passwordHash: "hash", role: "admin" });
      assert.equal(users.get(user.id)?.lastLoginAt, null);
      users.touchLogin(user.id, 1234);
      assert.equal(users.get(user.id)?.lastLoginAt, 1234);
    } finally {
      cleanup();
    }
  });
});

describe("SessionStore", () => {
  it("issues a token, reads it back and never stores the token itself", () => {
    const { db, users, cleanup } = prepared();
    try {
      const sessions = new SessionStore(HOUR_MS, db);
      const user = users.create({ login: "admin", passwordHash: "hash", role: "admin" });
      const created = sessions.create(user.id);

      assert.ok(created.token.length >= 32);
      const stored = db.prepare("SELECT token_hash FROM sessions").all() as { token_hash: string }[];
      assert.deepEqual(stored.map((row) => row.token_hash), [hashToken(created.token)]);

      const read = sessions.read(created.token);
      assert.ok(read);
      assert.equal(read.userId, user.id);
      assert.equal(sessions.read("not-a-token"), null);
    } finally {
      cleanup();
    }
  });

  it("drops an expired token when it is used", () => {
    const { db, users, cleanup } = prepared();
    try {
      const sessions = new SessionStore(1_000, db);
      const user = users.create({ login: "admin", passwordHash: "hash", role: "admin" });
      const created = sessions.create(user.id, 1_000);

      assert.equal(sessions.read(created.token, 1_500)?.expiresAt, 2_000);
      assert.equal(sessions.read(created.token, 2_000), null);
      assert.equal(countRows(db, "sessions"), 0);
    } finally {
      cleanup();
    }
  });

  it("extends the expiry of a token that keeps being used", () => {
    const { db, users, cleanup } = prepared();
    try {
      const sessions = new SessionStore(HOUR_MS, db);
      const user = users.create({ login: "admin", passwordHash: "hash", role: "admin" });
      const created = sessions.create(user.id, 0);

      const extended = sessions.read(created.token, 2 * 60_000);
      assert.ok(extended);
      assert.equal(extended.expiresAt, 2 * 60_000 + HOUR_MS);
    } finally {
      cleanup();
    }
  });

  it("revokes every session of a user at once", () => {
    const { db, users, cleanup } = prepared();
    try {
      const sessions = new SessionStore(HOUR_MS, db);
      const user = users.create({ login: "admin", passwordHash: "hash", role: "admin" });
      const other = users.create({ login: "viewer", passwordHash: "hash", role: "guest" });
      const first = sessions.create(user.id);
      const second = sessions.create(user.id);
      const foreign = sessions.create(other.id);

      assert.equal(sessions.revokeAllForUser(user.id), 2);
      assert.equal(sessions.read(first.token), null);
      assert.equal(sessions.read(second.token), null);
      assert.notEqual(sessions.read(foreign.token), null);
    } finally {
      cleanup();
    }
  });

  it("deleting a user deletes their sessions, which is what the foreign key is for", () => {
    const { db, users, cleanup } = prepared();
    try {
      const sessions = new SessionStore(HOUR_MS, db);
      const user = users.create({ login: "admin", passwordHash: "hash", role: "admin" });
      sessions.create(user.id);

      assert.equal(users.remove(user.id), true);
      assert.equal(countRows(db, "sessions"), 0);
      assert.equal(users.remove(user.id), false);
    } finally {
      cleanup();
    }
  });

  it("purges expired sessions in one sweep", () => {
    const { db, users, cleanup } = prepared();
    try {
      const sessions = new SessionStore(1_000, db);
      const user = users.create({ login: "admin", passwordHash: "hash", role: "admin" });
      sessions.create(user.id, 0);
      sessions.create(user.id, 10_000);

      assert.equal(sessions.purgeExpired(5_000), 1);
      assert.equal(sessions.purgeExpired(5_000), 0);
    } finally {
      cleanup();
    }
  });
});
