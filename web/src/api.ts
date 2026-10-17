import type {
  LogPage,
  MetricsSnapshot,
  ServiceActionResponse,
  ServiceState,
  SystemInfo,
} from "../../src/types";

const TOKEN_KEY = "remotecontrol.token";
const HISTORY_WINDOW_MINUTES = 15;

export interface SystemResponse extends SystemInfo {
  server: {
    host: string;
    port: number;
    publicUrl: string | null;
    configPath: string;
  };
}

export interface HistoryResponse {
  windowMinutes: number;
  sampleIntervalMs: number;
  points: MetricsSnapshot[];
}

export interface ServicesResponse {
  services: ServiceState[];
}

export interface HealthResponse {
  ok: boolean;
  uptimeSeconds: number;
  sseClients: number;
}

export class ApiError extends Error {
  public constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function loadToken(): string | null {
  const stored = window.localStorage.getItem(TOKEN_KEY);
  return stored === null || stored.length === 0 ? null : stored;
}

export function saveToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = loadToken();
  const headers = new Headers(init.headers);
  if (token !== null) {
    headers.set("authorization", `Bearer ${token}`);
  }

  const response = await fetch(path, { ...init, headers });
  if (response.status === 401) {
    throw new ApiError(401, "unauthorized");
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(response.status, body.error ?? response.statusText);
  }
  return (await response.json()) as T;
}

export function fetchSystem(): Promise<SystemResponse> {
  return request<SystemResponse>("/api/system");
}

export function fetchServices(): Promise<ServicesResponse> {
  return request<ServicesResponse>("/api/services");
}

export function fetchHistory(): Promise<HistoryResponse> {
  return request<HistoryResponse>(`/api/metrics/history?window=${HISTORY_WINDOW_MINUTES}`);
}

export function fetchLog(id: string, bytes: number): Promise<LogPage> {
  return request<LogPage>(`/api/services/${encodeURIComponent(id)}/log?bytes=${bytes}`);
}

export function startService(id: string): Promise<ServiceActionResponse> {
  return request<ServiceActionResponse>(`/api/services/${encodeURIComponent(id)}/start`, { method: "POST" });
}

export function stopService(id: string): Promise<ServiceActionResponse> {
  return request<ServiceActionResponse>(`/api/services/${encodeURIComponent(id)}/stop`, { method: "POST" });
}

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
    /* EventSource retries on its own unless the browser closed it for good. */
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
