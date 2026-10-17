export type BusKind = "metrics" | "service" | "notice";

export interface BusMessage {
  kind: BusKind;
  ts: number;
  payload: unknown;
}

type Handler = (message: BusMessage) => void;

export class EventBus {
  private readonly handlers = new Set<Handler>();

  publish(kind: BusKind, payload: unknown): void {
    if (this.handlers.size === 0) {
      return;
    }
    const message: BusMessage = { kind, ts: Date.now(), payload };
    for (const handler of [...this.handlers]) {
      try {
        handler(message);
      } catch {
        /* A broken SSE client must not break the publisher. */
      }
    }
  }

  subscribe(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }
}
