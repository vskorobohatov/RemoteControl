import { randomUUID } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ServerResponse } from "node:http";
import { EventBus, type BusMessage } from "../lib/bus.js";

const HEARTBEAT_INTERVAL_MS = 15_000;
const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

function encode(message: BusMessage): string {
  return `event: ${message.kind}\ndata: ${JSON.stringify(message)}\n\n`;
}

export class SseHub {
  private readonly clients = new Map<string, ServerResponse>();
  private readonly heartbeat: NodeJS.Timeout;
  private readonly unsubscribe: () => void;

  constructor(bus: EventBus) {
    this.unsubscribe = bus.subscribe((message) => this.broadcast(encode(message)));
    this.heartbeat = setInterval(() => this.broadcast(": ping\n\n"), HEARTBEAT_INTERVAL_MS);
    this.heartbeat.unref();
  }

  attach(request: FastifyRequest, reply: FastifyReply): void {
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, SSE_HEADERS);
    raw.write(`event: hello\ndata: ${JSON.stringify({ kind: "hello", ts: Date.now() })}\n\n`);

    const id = randomUUID();
    this.clients.set(id, raw);
    request.log.debug({ clientId: id }, "sse client connected");

    const detach = (): void => {
      this.clients.delete(id);
    };
    raw.on("close", detach);
    raw.on("error", detach);
  }

  private broadcast(payload: string): void {
    for (const [id, client] of this.clients) {
      if (client.writableEnded || !client.writable) {
        this.clients.delete(id);
        continue;
      }
      try {
        client.write(payload);
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
      client.end();
    }
    this.clients.clear();
  }
}
