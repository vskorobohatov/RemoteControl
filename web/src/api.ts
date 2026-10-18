import type {
  AuthStatusResponse,
  CreateUserRequest,
  LogPage,
  LoginResponse,
  MetricsSnapshot,
  PublicUser,
  ServiceActionResponse,
  ServiceState,
  SessionResponse,
  SystemInfo,
  UpdateApplyResponse,
  UpdateStatus,
  UpdateUserRequest,
  UsersResponse,
} from "../../src/types";

/* The session token a login handed us. It is not the shared API token: it is short
   lived, tied to one account, and revoking it is what "sign out" means. */
const SESSION_KEY = "remotecontrol.session";
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

export function loadSessionToken(): string | null {
  const stored = window.localStorage.getItem(SESSION_KEY);
  return stored === null || stored.length === 0 ? null : stored;
}

export function saveSessionToken(token: string): void {
  window.localStorage.setItem(SESSION_KEY, token);
}

export function clearSessionToken(): void {
  window.localStorage.removeItem(SESSION_KEY);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = loadSessionToken();
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
  /* DELETE answers 204 with no body, so json() would throw on an empty stream. */
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

export function fetchAuthStatus(): Promise<AuthStatusResponse> {
  return request<AuthStatusResponse>("/api/auth/status");
}

export function bootstrapAccount(login: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>("/api/auth/bootstrap", json("POST", { login, password }));
}

export function login(login: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>("/api/auth/login", json("POST", { login, password }));
}

export function logout(): Promise<void> {
  return request<void>("/api/auth/logout", { method: "POST" });
}

export function fetchSession(): Promise<SessionResponse> {
  return request<SessionResponse>("/api/auth/session");
}

export function fetchUsers(): Promise<UsersResponse> {
  return request<UsersResponse>("/api/users");
}

export function createUser(input: CreateUserRequest): Promise<PublicUser> {
  return request<PublicUser>("/api/users", json("POST", input));
}

export function updateUser(id: number, input: UpdateUserRequest): Promise<PublicUser> {
  return request<PublicUser>(`/api/users/${id}`, json("PATCH", input));
}

export function deleteUser(id: number): Promise<void> {
  return request<void>(`/api/users/${id}`, { method: "DELETE" });
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

export function fetchUpdateStatus(): Promise<UpdateStatus> {
  return request<UpdateStatus>("/api/update/status");
}

export function checkForUpdates(): Promise<UpdateStatus> {
  return request<UpdateStatus>("/api/update/check", { method: "POST" });
}

export function applyUpdate(target?: string): Promise<UpdateApplyResponse> {
  return request<UpdateApplyResponse>("/api/update/apply", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(target === undefined ? {} : { target }),
  });
}

export function fetchUpdateLog(bytes: number): Promise<LogPage> {
  return request<LogPage>(`/api/update/log?bytes=${bytes}`);
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
