import type { Db } from "../db/connection.js";
import type { UserRole } from "../types.js";
import { DuplicateLoginError, isUniqueConstraintError } from "./errors.js";
import type { UserRecord } from "./types.js";

interface UserRow {
  id: number;
  login: string;
  password_hash: string;
  role: string;
  created_at: number;
  updated_at: number;
  last_login_at: number | null;
}

const ROLES: readonly UserRole[] = ["admin", "manager", "guest"];

const SELECT = "SELECT id, login, password_hash, role, created_at, updated_at, last_login_at FROM users";

function isUserRole(value: string): value is UserRole {
  return (ROLES as readonly string[]).includes(value);
}

function mapRow(row: UserRow): UserRecord | null {
  if (!isUserRole(row.role)) {
    return null;
  }
  return {
    id: row.id,
    login: row.login,
    passwordHash: row.password_hash,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  };
}

export interface NewUser {
  login: string;
  passwordHash: string;
  role: UserRole;
}

/** The only place that writes SQL against the users table. */
export class UserRepository {
  /* Prepared once per process; the type is inferred from this assignment. */
  private readonly statements;

  public constructor(db: Db) {
    this.statements = {
      list: db.prepare(`${SELECT} ORDER BY login`),
      byId: db.prepare(`${SELECT} WHERE id = ?`),
      byLogin: db.prepare(`${SELECT} WHERE login = ?`),
      count: db.prepare("SELECT COUNT(*) AS count FROM users"),
      countRole: db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = ?"),
      insert: db.prepare(
        "INSERT INTO users (login, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ),
      update: db.prepare("UPDATE users SET login = ?, role = ?, updated_at = ? WHERE id = ?"),
      password: db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?"),
      lastLogin: db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?"),
      remove: db.prepare("DELETE FROM users WHERE id = ?"),
      lastInsertId: db.prepare("SELECT last_insert_rowid() AS id"),
    };
  }

  public list(): UserRecord[] {
    const rows = this.statements.list.all() as UserRow[];
    return rows.map(mapRow).filter((user): user is UserRecord => user !== null);
  }

  public get(id: number): UserRecord | null {
    const row = this.statements.byId.get(id) as UserRow | undefined;
    return row === undefined ? null : mapRow(row);
  }

  /** Case-insensitive: the login column is declared COLLATE NOCASE. */
  public getByLogin(login: string): UserRecord | null {
    const row = this.statements.byLogin.get(login) as UserRow | undefined;
    return row === undefined ? null : mapRow(row);
  }

  public count(): number {
    return Number((this.statements.count.get() as { count: number }).count);
  }

  public countByRole(role: UserRole): number {
    return Number((this.statements.countRole.get(role) as { count: number }).count);
  }

  public create(input: NewUser, now: number = Date.now()): UserRecord {
    try {
      this.statements.insert.run(input.login, input.passwordHash, input.role, now, now);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new DuplicateLoginError(`login '${input.login}' is already taken`);
      }
      throw error;
    }
    const created = this.getByLogin(input.login);
    if (created !== null) {
      return created;
    }
    const row = this.statements.lastInsertId.get() as { id: number };
    const byId = this.get(Number(row.id));
    if (byId === null) {
      throw new Error(`user ${row.id} vanished while it was being created`);
    }
    return byId;
  }

  public update(id: number, login: string, role: UserRole, now: number = Date.now()): void {
    try {
      this.statements.update.run(login, role, now, id);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new DuplicateLoginError(`login '${login}' is already taken`);
      }
      throw error;
    }
  }

  public setPassword(id: number, passwordHash: string, now: number = Date.now()): void {
    this.statements.password.run(passwordHash, now, id);
  }

  public touchLogin(id: number, now: number = Date.now()): void {
    this.statements.lastLogin.run(now, id);
  }

  public remove(id: number): boolean {
    return this.statements.remove.run(id).changes > 0;
  }
}
