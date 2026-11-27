import type { LogPage, UpdateApplyResponse, UpdateStatus } from "@server/types";
import { json, request } from "@shared/api/client";

export function fetchUpdateStatus(): Promise<UpdateStatus> {
  return request<UpdateStatus>("/api/update/status");
}

export function checkForUpdates(): Promise<UpdateStatus> {
  return request<UpdateStatus>("/api/update/check", { method: "POST" });
}

export function resetUpdateStatus(): Promise<UpdateStatus> {
  return request<UpdateStatus>("/api/update/status", { method: "DELETE" });
}

export function applyUpdate(force = false): Promise<UpdateApplyResponse> {
  return request<UpdateApplyResponse>("/api/update/apply", json("POST", force ? { force: true } : {}));
}

export function fetchUpdateLog(bytes: number): Promise<LogPage> {
  return request<LogPage>(`/api/update/log?bytes=${bytes}`);
}
