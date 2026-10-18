import type { MetricsSnapshot, ServiceState } from "@server/types";

export interface StreamHandlers {
  onService: (service: ServiceState) => void;
  onMetrics: (snapshot: MetricsSnapshot) => void;
  onNotice: (message: string) => void;
  onOpen: () => void;
  onDisconnect: (terminal: boolean) => void;
}

export function openEventStream(token: string, handlers: StreamHandlers): EventSource {
  const source = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);

  source.addEventListener("open", handlers.onOpen);
  source.addEventListener("error", () => {
    handlers.onDisconnect(source.readyState === EventSource.CLOSED);
  });
  source.addEventListener("service", (event) => {
    const message = JSON.parse((event as MessageEvent).data) as { payload: ServiceState };
    handlers.onService(message.payload);
  });
  source.addEventListener("metrics", (event) => {
    const message = JSON.parse((event as MessageEvent).data) as { payload: MetricsSnapshot };
    handlers.onMetrics(message.payload);
  });
  source.addEventListener("notice", (event) => {
    const message = JSON.parse((event as MessageEvent).data) as { payload: { message: string } };
    handlers.onNotice(message.payload.message);
  });

  return source;
}
