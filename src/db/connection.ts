import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

/**
 * The one SQLite handle every persisted domain in RemoteControl shares. `InstanceType`
 * keeps this working whatever shape the bundled @types declaration happens to use.
 */
export type Db = InstanceType<typeof Database>;

export const DATABASE_FILE_NAME = "remotecontrol.db";

export function openDatabase(filePath: string): Db {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const db: Db = new Database(filePath);
  /* WAL so the API can read while another process in the same checkout writes,
     foreign_keys so ON DELETE CASCADE on sessions is real, and a busy timeout so two
     processes never fail on a lock they would have gotten a moment later. */
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  return db;
}
