import { randomUUID } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ServerResponse } from "node:http";
import { can } from "../auth/permissions.js";
import { EventBus, type BusMessage } from "../lib/bus.js";
import { SECURITY_HEADERS } from "./security.js";
import type { UserRole } from "../types.js";

const HEARTBEAT_INTERVAL_MS = 15_000;
const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

/** Which permission a frame needs, if any. service/notice frames are for everyone. */
const FRAME_PERMISSION: Partial<Record<BusMessage["kind"], Parameters<typeof can>[1]>> = {
  metrics: "metrics:view",
};

interface SseClient {
  res: ServerResponse;
  role: UserRole;
}

function encode(message: BusMessage): string {
  return `event: ${message.kind}\ndata: ${JSON.stringify(message)}\n\n`;
}

export class SseHub {
  private readonly clients = new Map<string, SseClient>();
  private readonly heartbeat: NodeJS.Timeout;
  private readonly unsubscribe: () => void;

  constructor(bus: EventBus) {
    this.unsubscribe = bus.subscribe((message) => this.dispatch(message));
    this.heartbeat = setInterval(() => this.broadcast(": ping\n\n", () => true), HEARTBEAT_INTERVAL_MS);
    this.heartbeat.unref();
  }

  attach(request: FastifyRequest, reply: FastifyReply): void {
    reply.hijack();
    const raw = reply.raw;
    /* The auth hook has already resolved who this is; the role decides which frames
       this connection is sent, so a guest never receives metrics at all. */
    const role: UserRole = request.user?.role ?? "guest";
    raw.writeHead(200, { ...SECURITY_HEADERS, ...SSE_HEADERS });
    raw.write(`event: hello\ndata: ${JSON.stringify({ kind: "hello", ts: Date.now() })}\n\n`);

    const id = randomUUID();
    this.clients.set(id, { res: raw, role });
    request.log.debug({ clientId: id, role }, "sse client connected");

    const detach = (): void => {
      this.clients.delete(id);
    };
    raw.on("close", detach);
    raw.on("error", detach);
  }

  private dispatch(message: BusMessage): void {
    const permission = FRAME_PERMISSION[message.kind];
    this.broadcast(encode(message), (role) => permission === undefined || can(role, permission));
  }

  private broadcast(payload: string, visibleTo: (role: UserRole) => boolean): void {
    for (const [id, client] of this.clients) {
      if (client.res.writableEnded || !client.res.writable) {
        this.clients.delete(id);
        continue;
      }
      if (!visibleTo(client.role)) {
        continue;
      }
      try {
        client.res.write(payload);
      } catch {
        this.clients.delete(id);
      }
    }
  }

  get clientCount(): number {
    return this.clients.size;
  }

  close(): void {
    clearInterval(this.heartbeat);
    this.unsubscribe();
    for (const client of this.clients.values()) {
      client.res.end();
    }
    this.clients.clear();
  }
}
