import type { PowerActionResponse, PowerStatus } from "@server/types";
import { request } from "@shared/api/client";

export function fetchPowerStatus(): Promise<PowerStatus> {
  return request<PowerStatus>("/api/host/power");
}

export function shutdownHost(): Promise<PowerActionResponse> {
  return request<PowerActionResponse>("/api/host/shutdown", { method: "POST" });
}

export function restartHost(): Promise<PowerActionResponse> {
  return request<PowerActionResponse>("/api/host/restart", { method: "POST" });
}
