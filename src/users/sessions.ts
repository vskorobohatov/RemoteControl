import { createHash, randomBytes } from "node:crypto";
import type { Db } from "../db/connection.js";
import type { SessionRecord } from "./types.js";

const TOKEN_BYTES = 32;
/* A session is extended when it is used, but a browser refreshes every few seconds, so
   writing the new expiry on every request would be pure write amplification. */
const TOUCH_INTERVAL_MS = 60_000;

interface SessionRow {
  token_hash: string;
  user_id: number;
  created_at: number;
  expires_at: number;
  last_seen_at: number;
}

export interface CreatedSession {
  /** The only time this value exists; the database keeps just its SHA-256. */
  token: string;
  expiresAt: number;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function mapRow(row: SessionRow): SessionRecord {
  return {
    tokenHash: row.token_hash,
    userId: row.user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
  };
}

export class SessionStore {
  /* Prepared once per process; the type is inferred from this assignment. */
  private readonly statements;

  public constructor(
    private readonly ttlMs: number,
    db: Db,
  ) {
    this.statements = {
      insert: db.prepare(
        "INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)",
      ),
      read: db.prepare(
        "SELECT token_hash, user_id, created_at, expires_at, last_seen_at FROM sessions WHERE token_hash = ?",
      ),
      touch: db.prepare("UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE token_hash = ?"),
      revoke: db.prepare("DELETE FROM sessions WHERE token_hash = ?"),
      revokeForUser: db.prepare("DELETE FROM sessions WHERE user_id = ?"),
      purge: db.prepare("DELETE FROM sessions WHERE expires_at <= ?"),
    };
  }

  public create(userId: number, now: number = Date.now()): CreatedSession {
    const token = randomBytes(TOKEN_BYTES).toString("base64url");
    const expiresAt = now + this.ttlMs;
    this.statements.insert.run(hashToken(token), userId, now, expiresAt, now);
    return { token, expiresAt };
  }

  /** Returns null for an unknown or expired token, and drops the row when it is expired. */
  public read(token: string, now: number = Date.now()): SessionRecord | null {
    const row = this.statements.read.get(hashToken(token)) as SessionRow | undefined;
    if (row === undefined) {
      return null;
    }
    const session = mapRow(row);
    if (session.expiresAt <= now) {
      this.statements.revoke.run(session.tokenHash);
      return null;
    }
    if (now - session.lastSeenAt >= TOUCH_INTERVAL_MS) {
      const expiresAt = now + this.ttlMs;
      this.statements.touch.run(expiresAt, now, session.tokenHash);
      return { ...session, expiresAt, lastSeenAt: now };
    }
    return session;
  }

  public revoke(token: string): boolean {
    return this.statements.revoke.run(hashToken(token)).changes > 0;
  }

  /** Used when a role changes or an account is deleted: old tokens stop working at once. */
  public revokeAllForUser(userId: number): number {
    return this.statements.revokeForUser.run(userId).changes;
  }

  public purgeExpired(now: number = Date.now()): number {
    return this.statements.purge.run(now).changes;
  }
}
