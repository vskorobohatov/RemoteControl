import type { Permission, PublicUser, UpdateUserRequest, UserRole } from "../types.js";
import { permissionsOf } from "../auth/permissions.js";
import { DuplicateLoginError, LastAdminError, SelfDeleteError } from "./errors.js";
import { hashPassword, needsRehash, verifyPassword, verifyUnknownLogin } from "./passwords.js";
import type { UserRepository } from "./repository.js";
import type { SessionStore } from "./sessions.js";
import type { UserRecord } from "./types.js";

/** Lowercase letters, digits and the separators people actually type in a login. */
export const LOGIN_PATTERN = /^[a-z0-9][a-z0-9._-]{1,31}$/;

/* A login attempt costs a full scrypt run, so a few hundred guesses a second is worth
   limiting before it is worth worrying about. In-process only: restarting the service
   clears it, which is fine for a single-host tool. */
const MAX_ATTEMPTS_PER_WINDOW = 10;
const ATTEMPT_WINDOW_MS = 5 * 60_000;

export interface LoginResult {
  token: string;
  expiresAt: number;
  user: PublicUser;
  permissions: Permission[];
}

export interface SessionView {
  user: PublicUser;
  permissions: Permission[];
  expiresAt: number;
}

export interface CreateAccountRequest {
  login: string;
  password: string;
  role: UserRole;
}

function toPublic(user: UserRecord): PublicUser {
  return {
    id: user.id,
    login: user.login,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
  };
}

function attemptKey(login: string): string {
  return login.toLowerCase();
}

/**
 * Accounts, passwords and sessions in one place. The repository owns the rows and the
 * session store owns the tokens; this is where the rules live - the last admin cannot
 * be demoted, an account cannot delete itself, and a role change ends the old sessions.
 */
export class UserService {
  private readonly attempts = new Map<string, { count: number; resetAt: number }>();

  public constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionStore,
  ) {}

  public needsBootstrap(): boolean {
    return this.users.count() === 0;
  }

  public list(): PublicUser[] {
    return this.users.list().map(toPublic);
  }

  public get(id: number): PublicUser | null {
    const user = this.users.get(id);
    return user === null ? null : toPublic(user);
  }

  /** What the auth hook needs on every request, without the password hash. */
  public identityFor(id: number): { id: number; login: string; role: UserRole } | null {
    const user = this.users.get(id);
    if (user === null) {
      return null;
    }
    return { id: user.id, login: user.login, role: user.role };
  }

  /**
   * Creates the first admin. Returns null once any account exists, so this can never
   * hand out a second admin to whoever happens to open the page first.
   */
  public bootstrap(login: string, password: string): LoginResult | null {
    if (!this.needsBootstrap()) {
      return null;
    }
    const user = this.users.create({ login, passwordHash: hashPassword(password), role: "admin" });
    return this.startSession(user);
  }

  public login(login: string, password: string): LoginResult | null {
    if (this.isThrottled(login)) {
      /* Deliberately the same answer as a wrong password. */
      return null;
    }
    const user = this.users.getByLogin(login);
    if (user === null) {
      verifyUnknownLogin(password);
      this.recordFailure(login);
      return null;
    }
    if (!verifyPassword(password, user.passwordHash)) {
      this.recordFailure(login);
      return null;
    }
    this.attempts.delete(attemptKey(login));
    if (needsRehash(user.passwordHash)) {
      this.users.setPassword(user.id, hashPassword(password));
    }
    this.users.touchLogin(user.id);
    /* Read the row back so the response reports the login that just happened. */
    return this.startSession(this.users.get(user.id) ?? user);
  }

  public create(input: CreateAccountRequest): PublicUser {
    const user = this.users.create({
      login: input.login,
      passwordHash: hashPassword(input.password),
      role: input.role,
    });
    return toPublic(user);
  }

  public update(id: number, input: UpdateUserRequest, actorId: number): PublicUser | null {
    const user = this.users.get(id);
    if (user === null) {
      return null;
    }
    const login = input.login ?? user.login;
    const role = input.role ?? user.role;
    if (user.role === "admin" && role !== "admin" && this.users.countByRole("admin") <= 1) {
      throw new LastAdminError("the last admin account cannot be demoted");
    }

    if (login !== user.login || role !== user.role) {
      this.users.update(id, login, role);
    }
    if (input.password !== undefined) {
      this.users.setPassword(id, hashPassword(input.password));
    }
    /* A token carries the role it was issued for, so anything that changes who this
       account is ends those tokens. An admin resetting someone else's password signs
       them out too. */
    if (role !== user.role || (input.password !== undefined && id !== actorId)) {
      this.sessions.revokeAllForUser(id);
    }

    const updated = this.users.get(id);
    return updated === null ? null : toPublic(updated);
  }

  public remove(id: number, actorId: number): boolean {
    if (id === actorId) {
      throw new SelfDeleteError("you cannot delete the account you are signed in with");
    }
    const user = this.users.get(id);
    if (user === null) {
      return false;
    }
    if (user.role === "admin" && this.users.countByRole("admin") <= 1) {
      throw new LastAdminError("the last admin account cannot be deleted");
    }
    this.sessions.revokeAllForUser(id);
    return this.users.remove(id);
  }

  /** Rebuilds what a request may do from the identity the auth hook already resolved. */
  public sessionFor(userId: number, expiresAt: number): SessionView | null {
    const user = this.users.get(userId);
    if (user === null) {
      return null;
    }
    return { user: toPublic(user), permissions: permissionsOf(user.role), expiresAt };
  }

  public purgeExpiredSessions(): number {
    return this.sessions.purgeExpired();
  }

  private startSession(user: UserRecord): LoginResult {
    const session = this.sessions.create(user.id);
    return {
      token: session.token,
      expiresAt: session.expiresAt,
      user: toPublic(user),
      permissions: permissionsOf(user.role),
    };
  }

  private isThrottled(login: string): boolean {
    const key = attemptKey(login);
    const entry = this.attempts.get(key);
    if (entry === undefined) {
      return false;
    }
    if (entry.resetAt <= Date.now()) {
      this.attempts.delete(key);
      return false;
    }
    return entry.count >= MAX_ATTEMPTS_PER_WINDOW;
  }

  private recordFailure(login: string): void {
    const key = attemptKey(login);
    const now = Date.now();
    const entry = this.attempts.get(key);
    if (entry === undefined || entry.resetAt <= now) {
      this.attempts.set(key, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
      return;
    }
    entry.count += 1;
  }
}

export { DuplicateLoginError, LastAdminError, SelfDeleteError };
