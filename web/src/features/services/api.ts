import type { LogPage, ServiceActionResponse, ServiceState } from "@server/types";
import { request } from "@shared/api/client";

export interface ServicesResponse {
  services: ServiceState[];
}

export function fetchServices(): Promise<ServicesResponse> {
  return request<ServicesResponse>("/api/services");
}

export function startService(id: string): Promise<ServiceActionResponse> {
  return request<ServiceActionResponse>(`/api/services/${encodeURIComponent(id)}/start`, { method: "POST" });
}

export function stopService(id: string): Promise<ServiceActionResponse> {
  return request<ServiceActionResponse>(`/api/services/${encodeURIComponent(id)}/stop`, { method: "POST" });
}

export function fetchLog(id: string, bytes: number): Promise<LogPage> {
  return request<LogPage>(`/api/services/${encodeURIComponent(id)}/log?bytes=${bytes}`);
}
