import type { LogPage, ServiceActionResponse, ServiceState } from "@server/types";
import { json, request } from "@shared/api/client";

export interface ServicesResponse {
  services: ServiceState[];
}

export function fetchServices(): Promise<ServicesResponse> {
  return request<ServicesResponse>("/api/services");
}

/* `model` picks an option of the service's model selector; null lets the server reuse
   the model of the last start. `api_key` is the value of the environment the service
   declared it reads its key from; null reuses the key of the last start. */
export function startService(id: string, model: string | null, apiKey: string | null): Promise<ServiceActionResponse> {
  return request<ServiceActionResponse>(
    `/api/services/${encodeURIComponent(id)}/start`,
    json(
      "POST",
      {
        ...(model === null ? {} : { model }),
        ...(apiKey === null ? {} : { api_key: apiKey }),
      },
    ),
  );
}

export function stopService(id: string): Promise<ServiceActionResponse> {
  return request<ServiceActionResponse>(`/api/services/${encodeURIComponent(id)}/stop`, { method: "POST" });
}

export function fetchLog(id: string, bytes: number): Promise<LogPage> {
  return request<LogPage>(`/api/services/${encodeURIComponent(id)}/log?bytes=${bytes}`);
}
