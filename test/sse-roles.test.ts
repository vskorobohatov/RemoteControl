import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FastifyReply, FastifyRequest } from "fastify";
import { SseHub } from "../src/api/sse.js";
import { EventBus } from "../src/lib/bus.js";
import type { UserRole } from "../src/types.js";

/* The hub only ever touches a handful of ServerResponse methods, so a recording fake is
   enough to see exactly which frames a role is sent. */
class FakeResponse {
  public readonly frames: string[] = [];
  public writable = true;
  public writableEnded = false;

  public writeHead(): this {
    return this;
  }

  public write(chunk: string): boolean {
    this.frames.push(chunk);
    return true;
  }

  public on(): this {
    return this;
  }

  public end(): void {
    this.writableEnded = true;
  }

  public count(event: string): number {
    return this.frames.filter((frame) => frame.startsWith(`event: ${event}\n`)).length;
  }
}

function attach(hub: SseHub, role: UserRole | null): FakeResponse {
  const raw = new FakeResponse();
  const request = {
    user: role === null ? null : { id: 1, login: role, role, sessionId: "s", expiresAt: 0 },
    log: { debug: () => undefined },
  } as unknown as FastifyRequest;
  const reply = { hijack: () => undefined, raw } as unknown as FastifyReply;
  hub.attach(request, reply);
  return raw;
}

describe("sse role filtering", () => {
  it("sends metrics only to roles that may view them", () => {
    const bus = new EventBus();
    const hub = new SseHub(bus);
    try {
      const admin = attach(hub, "admin");
      const manager = attach(hub, "manager");
      const guest = attach(hub, "guest");

      bus.publish("metrics", { t: 1, cpu: 1 });
      bus.publish("service", { id: "docker", status: "running" });
      bus.publish("notice", { message: "hello" });

      assert.equal(admin.count("metrics"), 1);
      assert.equal(manager.count("metrics"), 1);
      assert.equal(guest.count("metrics"), 0);

      /* Service state and notices are what a guest is here to see. */
      for (const client of [admin, manager, guest]) {
        assert.equal(client.count("service"), 1);
        assert.equal(client.count("notice"), 1);
      }
      assert.equal(hub.clientCount, 3);
    } finally {
      hub.close();
    }
  });

  it("treats a request with no resolved identity as a guest", () => {
    const bus = new EventBus();
    const hub = new SseHub(bus);
    try {
      const anonymous = attach(hub, null);
      bus.publish("metrics", { t: 1 });
      bus.publish("service", { id: "docker" });
      assert.equal(anonymous.count("metrics"), 0);
      assert.equal(anonymous.count("service"), 1);
    } finally {
      hub.close();
    }
  });

  it("drops a client whose response is no longer writable", () => {
    const bus = new EventBus();
    const hub = new SseHub(bus);
    try {
      const client = attach(hub, "admin");
      client.writable = false;
      bus.publish("service", { id: "docker" });
      assert.equal(hub.clientCount, 0);
    } finally {
      hub.close();
    }
  });
});
