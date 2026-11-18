import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { openDatabase, type Db } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrations.js";
import { ApiKeyStore } from "../src/services/keystore.js";

interface TempDatabase {
  db: Db;
  file: string;
  reopen: () => Db;
  cleanup: () => void;
}

function tempDatabase(): TempDatabase {
  const dir = mkdtempSync(path.join(tmpdir(), "rc-keys-db-"));
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

function prepared(): TempDatabase & { keys: ApiKeyStore } {
  const temp = tempDatabase();
  runMigrations(temp.db);
  return { ...temp, keys: new ApiKeyStore(temp.db) };
}

describe("ApiKeyStore", () => {
  it("holds nothing before a start hands over a key", () => {
    const temp = prepared();
    try {
      assert.equal(temp.keys.get("strata"), null);
    } finally {
      temp.cleanup();
    }
  });

  it("keeps the key together with the environment it was read from", () => {
    const temp = prepared();
    try {
      temp.keys.set("strata", "STRATA_API_KEY", "typed-key", 1_000);
      const stored = temp.keys.get("strata");
      assert.ok(stored !== null);
      assert.deepEqual(stored, {
        serviceId: "strata",
        envName: "STRATA_API_KEY",
        apiKey: "typed-key",
        updatedAt: 1_000,
      });
    } finally {
      temp.cleanup();
    }
  });

  it("finds the key again in a reopened database", () => {
    const temp = prepared();
    try {
      temp.keys.set("strata", "STRATA_API_KEY", "typed-key", 1_000);
      /* A restarted server gets a fresh handle on the same file: the key it stored
         for the service must still be there, that is the whole point of the table. */
      const reopened = new ApiKeyStore(temp.reopen());
      assert.deepEqual(reopened.get("strata"), {
        serviceId: "strata",
        envName: "STRATA_API_KEY",
        apiKey: "typed-key",
        updatedAt: 1_000,
      });
    } finally {
      temp.cleanup();
    }
  });

  it("replaces a stored key instead of adding a second row", () => {
    const temp = prepared();
    try {
      temp.keys.set("strata", "STRATA_API_KEY", "first", 1_000);
      temp.keys.set("strata", "STRATA_API_KEY", "second", 2_000);
      const stored = temp.keys.get("strata");
      assert.equal(stored?.apiKey, "second");
      assert.equal(stored?.updatedAt, 2_000);
    } finally {
      temp.cleanup();
    }
  });

  it("follows a service that changed the environment it reads its key from", () => {
    const temp = prepared();
    try {
      temp.keys.set("strata", "STRATA_API_KEY", "same-key", 1_000);
      temp.keys.set("strata", "OTHER_KEY_ENV", "other-key", 2_000);
      const stored = temp.keys.get("strata");
      assert.equal(stored?.envName, "OTHER_KEY_ENV");
      assert.equal(stored?.apiKey, "other-key");
    } finally {
      temp.cleanup();
    }
  });

  it("forgets only the keys of services the file no longer names", () => {
    const temp = prepared();
    try {
      temp.keys.set("strata", "STRATA_API_KEY", "kept", 1_000);
      temp.keys.set("removed-service", "OTHER_KEY_ENV", "orphan", 1_000);
      assert.equal(temp.keys.pruneUnknown(["strata"]), 1);
      assert.equal(temp.keys.get("removed-service"), null);
      assert.equal(temp.keys.get("strata")?.apiKey, "kept");
    } finally {
      temp.cleanup();
    }
  });

  it("clears a stored key when asked to", () => {
    const temp = prepared();
    try {
      temp.keys.set("strata", "STRATA_API_KEY", "kept", 1_000);
      assert.equal(temp.keys.clear("strata"), true);
      assert.equal(temp.keys.clear("strata"), false);
    } finally {
      temp.cleanup();
    }
  });
});
