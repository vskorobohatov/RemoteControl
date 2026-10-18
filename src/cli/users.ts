#!/usr/bin/env node
/* Account recovery for when nobody can log in - the browser is not the only way in.

   npm run users -- list
   npm run users -- create <login> <password> [--role admin|manager|guest]
   npm run users -- passwd <login> <password>

   It writes to the same database the running service uses, so it works while the
   service is up. Changing a password or a role ends that account's sessions
   immediately.
*/
import path from "node:path";
import { z } from "zod";
import { API_TOKEN_ID } from "../auth/types.js";
import { ConfigError, loadConfig } from "../config.js";
import { openDatabase } from "../db/connection.js";
import { runMigrations } from "../db/migrations.js";
import { DuplicateLoginError, LastAdminError, SelfDeleteError } from "../users/errors.js";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "../users/passwords.js";
import { UserRepository } from "../users/repository.js";
import { SessionStore } from "../users/sessions.js";
import { LOGIN_PATTERN, UserService } from "../users/service.js";
import type { PublicUser, UserRole } from "../types.js";

const USAGE = `usage:
  npm run users -- list
  npm run users -- create <login> <password> [--role admin|manager|guest]
  npm run users -- passwd <login> <password>`;

const loginSchema = z.string().regex(LOGIN_PATTERN, "login must be 2-32 lowercase letters, digits, dots, dashes or underscores");
const passwordSchema = z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH);
const roleSchema = z.enum(["admin", "manager", "guest"]);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function formatTime(value: number | null): string {
  return value === null ? "-" : new Date(value).toISOString().slice(0, 16).replace("T", " ");
}

function printUsers(users: PublicUser[]): void {
  if (users.length === 0) {
    console.log("no accounts yet - open the dashboard to create the first admin");
    return;
  }
  const rows = users.map((user) => [
    String(user.id),
    user.login,
    user.role,
    formatTime(user.lastLoginAt),
    formatTime(user.createdAt),
  ]);
  const headers = ["id", "login", "role", "last login", "created"];
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length)),
  );
  const line = (cells: string[]): string =>
    cells.map((cell, index) => cell.padEnd(widths[index] ?? cell.length)).join("  ");

  console.log(line(headers));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) {
    console.log(line(row));
  }
}

function parseRole(args: string[]): { role: UserRole; rest: string[] } {
  const index = args.indexOf("--role");
  if (index === -1) {
    return { role: "manager", rest: args };
  }
  const raw = args[index + 1];
  const parsed = roleSchema.safeParse(raw);
  if (!parsed.success) {
    fail(`--role must be admin, manager or guest\n\n${USAGE}`);
  }
  return { role: parsed.data, rest: [...args.slice(0, index), ...args.slice(index + 2)] };
}

function main(): void {
  const [command, ...args] = process.argv.slice(2);
  if (command === undefined) {
    fail(USAGE);
  }

  const rootDir = path.resolve(process.env.RC_ROOT_DIR ?? process.cwd());
  const config = loadConfig(rootDir);
  const db = openDatabase(config.storage.databasePath);
  const migrations = runMigrations(db);
  const sessions = new SessionStore(config.auth.sessionTtlMs, db);
  const repository = new UserRepository(db);
  const users = new UserService(repository, sessions);

  const run = (): void => {
    if (command === "list") {
      printUsers(users.list());
      return;
    }

    if (command === "create" || command === "passwd") {
      const { role, rest } = parseRole(args);
      const [rawLogin, rawPassword] = rest;
      const login = loginSchema.safeParse(rawLogin);
      if (!login.success) {
        fail(`login: ${login.error.issues[0]?.message ?? "invalid"}\n\n${USAGE}`);
      }
      const password = passwordSchema.safeParse(rawPassword);
      if (!password.success) {
        fail(`password: ${password.error.issues[0]?.message ?? "invalid"}\n\n${USAGE}`);
      }

      if (command === "create") {
        const created = users.create({ login: login.data, password: password.data, role });
        console.log(`created ${created.role} account '${created.login}' (id ${created.id})`);
        return;
      }

      const existing = repository.getByLogin(login.data);
      if (existing === null) {
        fail(`no account named '${login.data}'`);
      }
      /* The CLI is not the account's own session, so this counts as someone else
         resetting the password and the account's existing sessions stop working. */
      const updated = users.update(existing.id, { password: password.data }, API_TOKEN_ID);
      if (updated === null) {
        fail(`no account named '${login.data}'`);
      }
      console.log(`password updated for '${updated.login}'; its sessions no longer work`);
      return;
    }

    fail(`unknown command '${command}'\n\n${USAGE}`);
  };

  try {
    if (migrations.length > 0) {
      console.log(`applied ${migrations.length} migration(s) to ${config.storage.databasePath}`);
    }
    run();
  } catch (error) {
    if (error instanceof DuplicateLoginError || error instanceof LastAdminError || error instanceof SelfDeleteError) {
      fail(error.message);
    }
    throw error;
  } finally {
    db.close();
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof ConfigError ? `config error: ${error.message}` : String(error);
  console.error(message);
  process.exit(1);
}
