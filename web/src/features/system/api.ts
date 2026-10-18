import type { SystemInfo } from "@server/types";
import { request } from "@shared/api/client";

export interface SystemResponse extends SystemInfo {
  server: {
    host: string;
    port: number;
    publicUrl: string | null;
    configPath: string;
  };
}

export function fetchSystem(): Promise<SystemResponse> {
  return request<SystemResponse>("/api/system");
}
