import type { Db } from "./connection.js";

export interface Migration {
  id: number;
  name: string;
  sql: string;
}

/**
 * Append-only: never edit a migration that has already been applied on a host, add the
 * next one. That is how a new field - or a whole new domain such as an audit log or
 * per-service overrides - gets added without touching what is already on disk.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    id: 1,
    name: "users-and-sessions",
    sql: `
      CREATE TABLE users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        login         TEXT NOT NULL COLLATE NOCASE UNIQUE,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'guest')),
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL,
        last_login_at INTEGER
      );

      CREATE TABLE sessions (
        token_hash   TEXT PRIMARY KEY,
        user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        created_at   INTEGER NOT NULL,
        expires_at   INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
      );

      CREATE INDEX sessions_expires_idx ON sessions (expires_at);
    `,
  },
];

/**
 * Applies every migration that is not in schema_migrations yet, each in its own
 * transaction, so a half-applied migration is never recorded as done. Safe to call on
 * every start.
 */
export function runMigrations(db: Db): readonly Migration[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `);

  const rows = db.prepare("SELECT id FROM schema_migrations ORDER BY id").all() as { id: number }[];
  const applied = new Set(rows.map((row) => row.id));
  const highest = rows.at(-1)?.id ?? 0;
  const record = db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)");
  const appliedNow: Migration[] = [];

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) {
      continue;
    }
    if (migration.id <= highest) {
      throw new Error(
        `migration ${migration.id} (${migration.name}) is out of order: ${highest} is already applied`,
      );
    }
    db.transaction(() => {
      db.exec(migration.sql);
      record.run(migration.id, migration.name, Date.now());
    })();
    appliedNow.push(migration);
  }

  return appliedNow;
}
