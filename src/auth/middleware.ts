import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";
import type { Permission, PublicUser } from "../types.js";
import type { SessionStore } from "../users/sessions.js";
import type { UserService } from "../users/service.js";
import { can } from "./permissions.js";
import { API_TOKEN_ID, API_TOKEN_SESSION, type AuthenticatedUser } from "./types.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by the hook below on every /api/ route that is not anonymous. */
    user: AuthenticatedUser | null;
  }
}

/** Everything that has to work before anybody has an account. */
const ANONYMOUS_PATHS = new Set(["/api/health", "/api/auth/status", "/api/auth/bootstrap", "/api/auth/login"]);

/** The shared API token is not an account, so it gets a fixed identity the UI can show. */
export const API_TOKEN_USER: PublicUser = {
  id: API_TOKEN_ID,
  login: "api",
  role: "admin",
  createdAt: 0,
  updatedAt: 0,
  lastLoginAt: null,
};

export interface AuthDependencies {
  config: AppConfig;
  users: UserService;
  sessions: SessionStore;
}

export function bearerOrTokenParam(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header === "string" && header.toLowerCase().startsWith("bearer ")) {
    const token = header.slice(7).trim();
    if (token.length > 0) {
      return token;
    }
  }
  /* EventSource cannot send headers, so the event stream passes the session as a query parameter. */
  const query = request.query as Record<string, unknown>;
  return typeof query.token === "string" && query.token.length > 0 ? query.token : null;
}

function pathOf(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

function tokenMatches(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Resolves the caller for every /api/ route. It runs as onRequest so a request that is
 * not allowed never reaches a handler, and so the SSE stream knows who to filter frames
 * for before it starts writing.
 */
export function registerAuthHooks(app: FastifyInstance, deps: AuthDependencies): void {
  app.addHook("onRequest", async (request, reply) => {
    request.user = null;

    const path = pathOf(request.url);
    if (!path.startsWith("/api/") || ANONYMOUS_PATHS.has(path)) {
      return;
    }

    const token = bearerOrTokenParam(request);
    if (token === null) {
      await reply.code(401).send({ error: "unauthorized" });
      return;
    }

    /* auth.token stays working as a break-glass admin credential for scripts and health
       probes; accounts are how people use the dashboard. */
    const apiToken = deps.config.auth.apiToken;
    if (apiToken.length > 0 && tokenMatches(token, apiToken)) {
      request.user = {
        id: API_TOKEN_ID,
        login: API_TOKEN_USER.login,
        role: "admin",
        sessionId: API_TOKEN_SESSION,
        expiresAt: Number.MAX_SAFE_INTEGER,
      };
      return;
    }

    const session = deps.sessions.read(token);
    if (session === null) {
      await reply.code(401).send({ error: "unauthorized" });
      return;
    }
    const user = deps.users.identityFor(session.userId);
    if (user === null) {
      deps.sessions.revoke(token);
      await reply.code(401).send({ error: "unauthorized" });
      return;
    }

    request.user = {
      id: user.id,
      login: user.login,
      role: user.role,
      sessionId: session.tokenHash,
      expiresAt: session.expiresAt,
    };
  });
}

/** Per-route gate: app.get(path, { preHandler: requirePermission("users:manage") }, handler). */
export function requirePermission(permission: Permission) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (request.user === null) {
      await reply.code(401).send({ error: "unauthorized" });
      return;
    }
    if (!can(request.user.role, permission)) {
      await reply.code(403).send({
        error: "forbidden",
        detail: `role '${request.user.role}' may not ${permission}`,
      });
    }
  };
}

export function isApiToken(identity: AuthenticatedUser): boolean {
  return identity.sessionId === API_TOKEN_SESSION;
}
