import { timingSafeEqual } from "node:crypto";
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
import type { AppConfig } from "../config.js";
import type { EventBus } from "../lib/bus.js";
import type { MetricsStore } from "../metrics/store.js";
import type { ServiceManager } from "../services/manager.js";
import { readServiceLog } from "../services/logs.js";
import type { UpdateService } from "../update/service.js";
import type { SystemInfo } from "../types.js";
import { SseHub } from "./sse.js";

export interface AppContext {
  config: AppConfig;
  bus: EventBus;
  store: MetricsStore;
  services: ServiceManager;
  updates: UpdateService;
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

function tokenMatches(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header === "string" && header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  /* EventSource cannot send headers, so allow the token as a query parameter. */
  const query = request.query as Record<string, unknown>;
  return typeof query.token === "string" ? query.token : null;
}

export async function createServer(context: AppContext): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: process.env.RC_LOG_LEVEL ?? "info" }, bodyLimit: 64 * 1024 });
  const hub = new SseHub(context.bus);
  app.addHook("onClose", async () => hub.close());

  app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.url.startsWith("/api/") || request.url.startsWith("/api/health")) {
      return;
    }
    const token = bearerToken(request);
    if (token === null || !tokenMatches(token, context.config.authToken)) {
      await reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.get("/api/health", async () => ({
    ok: true,
    uptimeSeconds: Math.round((Date.now() - context.startedAt) / 1000),
    sseClients: hub.clientCount,
  }));

  app.get("/api/system", async () => ({
    ...context.systemInfo,
    server: {
      host: context.config.server.host,
      port: context.config.server.port,
      publicUrl: context.config.server.publicUrl,
      configPath: path.join(context.config.rootDir, "config"),
    },
  }));

  app.get("/api/services", async () => ({ services: context.services.list() }));

  app.get<{ Params: { id: string } }>("/api/services/:id", async (request, reply) => {
    const service = context.services.get(request.params.id);
    if (!service) {
      return reply.code(404).send({ error: "unknown service" });
    }
    return service;
  });

  app.post<{ Params: { id: string } }>("/api/services/:id/start", async (request, reply) => {
    try {
      const result = await context.services.start(request.params.id);
      return { message: result.message, service: result.service };
    } catch (error) {
      return reply.code(404).send({ error: String(error) });
    }
  });

  app.post<{ Params: { id: string } }>("/api/services/:id/stop", async (request, reply) => {
    try {
      const result = await context.services.stop(request.params.id);
      return { message: result.message, service: result.service };
    } catch (error) {
      return reply.code(404).send({ error: String(error) });
    }
  });

  app.get<{ Params: { id: string }; Querystring: { bytes?: string } }>("/api/services/:id/log", async (request, reply) => {
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


  app.get("/api/update/status", async () => context.updates.status());

  app.post("/api/update/check", async () => await context.updates.check());

  app.post<{ Body: { target?: string } }>("/api/update/apply", async (request, reply) => {
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

  app.get<{ Querystring: { bytes?: string } }>("/api/update/log", async (request, reply) => {
    const parsed = logQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid request" });
    }
    return await context.updates.readLog(parsed.data.bytes);
  });

  app.get("/api/metrics/latest", async () => ({
    snapshot: context.store.latest(),
    storedPoints: context.store.count(),
  }));

  app.get<{ Querystring: { window?: string } }>("/api/metrics/history", async (request, reply) => {
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

  app.get("/api/events", async (request, reply) => {
    hub.attach(request, reply);
  });

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
    const status = error instanceof z.ZodError ? 400 : (error.statusCode ?? 500);
    return reply.code(status).send({ error: error.message });
  });

  return app;
}
