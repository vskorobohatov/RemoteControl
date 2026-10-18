import type { UserRole } from "../types.js";

/** A row of the users table, password hash included. Never leaves the server. */
export interface UserRecord {
  id: number;
  login: string;
  passwordHash: string;
  role: UserRole;
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
}

/** A row of the sessions table. The live token is only ever its SHA-256. */
export interface SessionRecord {
  tokenHash: string;
  userId: number;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
}
