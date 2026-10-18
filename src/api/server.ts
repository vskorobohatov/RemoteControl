import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import {
  API_TOKEN_USER,
  bearerOrTokenParam,
  isApiToken,
  registerAuthHooks,
  requirePermission,
} from "../auth/middleware.js";
import { permissionsOf } from "../auth/permissions.js";
import type { AppConfig } from "../config.js";
import type { EventBus } from "../lib/bus.js";
import type { MetricsStore } from "../metrics/store.js";
import type { ServiceManager } from "../services/manager.js";
import { readServiceLog } from "../services/logs.js";
import type { UpdateService } from "../update/service.js";
import type { SystemInfo } from "../types.js";
import { DuplicateLoginError, LastAdminError, SelfDeleteError } from "../users/errors.js";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "../users/passwords.js";
import type { SessionStore } from "../users/sessions.js";
import { LOGIN_PATTERN, type UserService } from "../users/service.js";
import { SseHub } from "./sse.js";

export interface AppContext {
  config: AppConfig;
  bus: EventBus;
  store: MetricsStore;
  services: ServiceManager;
  updates: UpdateService;
  users: UserService;
  sessions: SessionStore;
  systemInfo: SystemInfo;
  startedAt: number;
}

const historyQuerySchema = z.object({
  window: z.coerce.number().int().min(1).max(240).default(15),
});

const logQuerySchema = z.object({
  bytes: z.coerce.number().int().min(1024).max(2 * 1024 * 1024).default(64 * 1024),
});

const applyBodySchema = z.object({
  target: z.string().min(1).max(64).optional(),
});

const roleSchema = z.enum(["admin", "manager", "guest"]);
const loginSchema = z
  .string()
  .regex(LOGIN_PATTERN, "login must be 2-32 lowercase letters, digits, dots, dashes or underscores");
const passwordSchema = z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH);

const credentialsSchema = z.object({ login: loginSchema, password: passwordSchema });
const createUserSchema = credentialsSchema.extend({ role: roleSchema });
const updateUserSchema = z
  .object({
    login: loginSchema.optional(),
    role: roleSchema.optional(),
    password: passwordSchema.optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: "nothing to update",
  });

function badRequest(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({ error: error.issues[0]?.message ?? "invalid request" });
}

function parseUserId(raw: string): number | null {
  const parsed = z.coerce.number().int().positive().safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** The preHandler already rejected an anonymous request; this only satisfies the type. */
function actorId(request: FastifyRequest): number {
  return request.user?.id ?? 0;
}

function statusFor(error: unknown): number {
  if (error instanceof z.ZodError) {
    return 400;
  }
  if (error instanceof DuplicateLoginError || error instanceof LastAdminError || error instanceof SelfDeleteError) {
    return 409;
  }
  return (error as { statusCode?: number }).statusCode ?? 500;
}

export async function createServer(context: AppContext): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: process.env.RC_LOG_LEVEL ?? "info" }, bodyLimit: 64 * 1024 });
  const hub = new SseHub(context.bus);
  app.addHook("onClose", async () => hub.close());

  registerAuthHooks(app, { config: context.config, users: context.users, sessions: context.sessions });

  app.get("/api/health", async () => ({
    ok: true,
    uptimeSeconds: Math.round((Date.now() - context.startedAt) / 1000),
    sseClients: hub.clientCount,
  }));

  /* --- accounts ------------------------------------------------------------- */

  app.get("/api/auth/status", async () => ({ needsBootstrap: context.users.needsBootstrap() }));

  app.post("/api/auth/bootstrap", async (request, reply) => {
    const parsed = credentialsSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return badRequest(reply, parsed.error);
    }
    const result = context.users.bootstrap(parsed.data.login, parsed.data.password);
    if (result === null) {
      return reply.code(409).send({ error: "accounts already exist" });
    }
    return reply.code(201).send(result);
  });

  app.post("/api/auth/login", async (request, reply) => {
    const parsed = credentialsSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return badRequest(reply, parsed.error);
    }
    const result = context.users.login(parsed.data.login, parsed.data.password);
    if (result === null) {
      return reply.code(401).send({ error: "invalid login or password" });
    }
    return result;
  });

  app.post("/api/auth/logout", async (request) => {
    const token = bearerOrTokenParam(request);
    if (token !== null) {
      context.sessions.revoke(token);
    }
    return { ok: true };
  });

  app.get("/api/auth/session", async (request, reply) => {
    const identity = request.user;
    if (identity === null) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    if (isApiToken(identity)) {
      return { user: API_TOKEN_USER, permissions: permissionsOf("admin"), expiresAt: identity.expiresAt };
    }
    const view = context.users.sessionFor(identity.id, identity.expiresAt);
    if (view === null) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return view;
  });

  /* --- the machine ---------------------------------------------------------- */

  app.get("/api/system", async () => ({
    ...context.systemInfo,
    server: {
      host: context.config.server.host,
      port: context.config.server.port,
      publicUrl: context.config.server.publicUrl,
      configPath: path.join(context.config.rootDir, "config"),
    },
  }));

  app.get("/api/services", { preHandler: requirePermission("services:view") }, async () => ({
    services: context.services.list(),
  }));

  app.get<{ Params: { id: string } }>(
    "/api/services/:id",
    { preHandler: requirePermission("services:view") },
    async (request, reply) => {
    const service = context.services.get(request.params.id);
    if (!service) {
      return reply.code(404).send({ error: "unknown service" });
    }
    return service;
  });

  app.post<{ Params: { id: string } }>(
    "/api/services/:id/start",
    { preHandler: requirePermission("services:control") },
    async (request, reply) => {
    try {
      const result = await context.services.start(request.params.id);
      return { message: result.message, service: result.service };
    } catch (error) {
      return reply.code(404).send({ error: String(error) });
    }
  });

  app.post<{ Params: { id: string } }>(
    "/api/services/:id/stop",
    { preHandler: requirePermission("services:control") },
    async (request, reply) => {
    try {
      const result = await context.services.stop(request.params.id);
      return { message: result.message, service: result.service };
    } catch (error) {
      return reply.code(404).send({ error: String(error) });
    }
  });

  app.get<{ Params: { id: string }; Querystring: { bytes?: string } }>(
    "/api/services/:id/log",
    { preHandler: requirePermission("services:logs") },
    async (request, reply) => {
    const service = context.services.get(request.params.id);
    if (!service) {
      return reply.code(404).send({ error: "unknown service" });
    }
    const parsed = logQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid request" });
    }
    return readServiceLog(service.id, service.logPath, parsed.data.bytes);
  });


  app.get("/api/update/status", { preHandler: requirePermission("update:view") }, async () => context.updates.status());

  app.post("/api/update/check", { preHandler: requirePermission("update:view") }, async () => await context.updates.check());

  app.post<{ Body: { target?: string } }>(
    "/api/update/apply",
    { preHandler: requirePermission("update:apply") },
    async (request, reply) => {
    const parsed = applyBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid request" });
    }
    const result = await context.updates.apply(parsed.data.target);
    if (!result.ok) {
      return reply.code(result.httpStatus).send({ error: result.message, status: result.status });
    }
    return reply.code(202).send({ message: result.message, status: result.status });
  });

  app.get<{ Querystring: { bytes?: string } }>(
    "/api/update/log",
    { preHandler: requirePermission("update:view") },
    async (request, reply) => {
    const parsed = logQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid request" });
    }
    return await context.updates.readLog(parsed.data.bytes);
  });

  app.get("/api/metrics/latest", { preHandler: requirePermission("metrics:view") }, async () => ({
    snapshot: context.store.latest(),
    storedPoints: context.store.count(),
  }));

  app.get<{ Querystring: { window?: string } }>(
    "/api/metrics/history",
    { preHandler: requirePermission("metrics:view") },
    async (request, reply) => {
    const parsed = historyQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid request" });
    }
    const toMs = Date.now();
    const fromMs = toMs - parsed.data.window * 60_000;
    return {
      windowMinutes: parsed.data.window,
      sampleIntervalMs: context.config.metrics.sampleIntervalMs,
      points: context.store.history({ fromMs, toMs, maxPoints: 1200 }),
    };
  });

  app.get("/api/events", { preHandler: requirePermission("services:view") }, async (request, reply) => {
    hub.attach(request, reply);
  });

  /* --- user accounts -------------------------------------------------------- */

  app.get("/api/users", { preHandler: requirePermission("users:manage") }, async () => ({
    users: context.users.list(),
  }));

  app.post("/api/users", { preHandler: requirePermission("users:manage") }, async (request, reply) => {
    const parsed = createUserSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return badRequest(reply, parsed.error);
    }
    return reply.code(201).send(context.users.create(parsed.data));
  });

  app.patch<{ Params: { id: string } }>(
    "/api/users/:id",
    { preHandler: requirePermission("users:manage") },
    async (request, reply) => {
      const id = parseUserId(request.params.id);
      if (id === null) {
        return reply.code(400).send({ error: "id must be a positive integer" });
      }
      const parsed = updateUserSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return badRequest(reply, parsed.error);
      }
      const updated = context.users.update(id, parsed.data, actorId(request));
      if (updated === null) {
        return reply.code(404).send({ error: "unknown user" });
      }
      return updated;
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/users/:id",
    { preHandler: requirePermission("users:manage") },
    async (request, reply) => {
      const id = parseUserId(request.params.id);
      if (id === null) {
        return reply.code(400).send({ error: "id must be a positive integer" });
      }
      if (!context.users.remove(id, actorId(request))) {
        return reply.code(404).send({ error: "unknown user" });
      }
      return reply.code(204).send();
    },
  );

  const distDir = path.join(context.config.rootDir, "dist", "client");
  const indexFile = path.join(distDir, "index.html");
  const indexHtml = existsSync(indexFile) ? readFileSync(indexFile, "utf8") : null;

  if (indexHtml !== null) {
    await app.register(fastifyStatic, { root: distDir, index: ["index.html"] });
  }

  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith("/api/")) {
      return reply.code(404).send({ error: "not found" });
    }
    if (indexHtml !== null) {
      return reply.type("text/html").send(indexHtml);
    }
    return reply
      .type("text/html")
      .send("<!doctype html><meta charset=utf-8><title>RemoteControl</title><p>Frontend not built. Run <code>npm run build</code>.</p>");
  });

  app.setErrorHandler(async (error: FastifyError, request, reply) => {
    request.log.error({ err: error }, "request failed");
    return reply.code(statusFor(error)).send({ error: error.message });
  });

  return app;
}
