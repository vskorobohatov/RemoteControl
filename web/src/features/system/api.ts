import type { SystemInfo } from "@server/types";
import { request } from "@shared/api/client";

export interface SystemResponse extends SystemInfo {
  server: {
    publicUrl: string | null;
  };
}

export function fetchSystem(): Promise<SystemResponse> {
  return request<SystemResponse>("/api/system");
}
