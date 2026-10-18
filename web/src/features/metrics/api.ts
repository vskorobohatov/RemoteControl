import type { MetricsSnapshot } from "@server/types";
import { request } from "@shared/api/client";

const HISTORY_WINDOW_MINUTES = 15;

export interface HistoryResponse {
  windowMinutes: number;
  sampleIntervalMs: number;
  points: MetricsSnapshot[];
}

export function fetchHistory(): Promise<HistoryResponse> {
  return request<HistoryResponse>(`/api/metrics/history?window=${HISTORY_WINDOW_MINUTES}`);
}
