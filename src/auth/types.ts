import type { UserRole } from "../types.js";

/** Who made this request, resolved once per request by the auth hook. */
export interface AuthenticatedUser {
  id: number;
  login: string;
  role: UserRole;
  /** SHA-256 of the bearer token, or API_TOKEN_SESSION for the break-glass API token. */
  sessionId: string;
  expiresAt: number;
}

export const API_TOKEN_SESSION = "api-token";

/** id 0 is never a real row: it belongs to the shared API token. */
export const API_TOKEN_ID = 0;
