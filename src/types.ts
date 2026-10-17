export type ServiceStatus =
  | "stopped"
  | "starting"
  | "running"
  | "ready"
  | "degraded"
  | "stopping"
  | "failed"
  | "external";

/** "rc" means started by RemoteControl, "external" means adopted from outside. */
export type ServiceManagedBy = "rc" | "external" | null;

export interface CpuMetrics {
  totalPercent: number;
  perCorePercent: number[];
  loadAvg: [number, number, number];
  temperatureC: number | null;
}

export interface MemoryMetrics {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  swapTotalBytes: number;
  swapUsedBytes: number;
}

export interface GpuMetrics {
  present: boolean;
  source: "sysfs" | "rocm-smi" | "none";
  model: string | null;
  busyPercent: number | null;
  vramTotalBytes: number | null;
  vramUsedBytes: number | null;
  temperaturesC: Record<string, number>;
  powerWatts: number | null;
  clocksMHz: Record<string, number>;
}

export interface MetricsSnapshot {
  t: number;
  cpu: CpuMetrics;
  memory: MemoryMetrics;
  gpu: GpuMetrics;
}

export interface SystemInfo {
  hostname: string;
  kernel: string;
  arch: string;
  appVersion: string;
  startedAt: number;
  uptimeSeconds: number;
  cpuModel: string;
  logicalCores: number;
  memoryTotalBytes: number;
  gpuModel: string | null;
  vramTotalBytes: number | null;
}

export interface ServiceHealth {
  ok: boolean;
  checkedAt: number;
  statusCode: number | null;
  detail: Record<string, unknown> | null;
  error: string | null;
}

export interface ServiceState {
  id: string;
  name: string;
  description: string;
  status: ServiceStatus;
  unit: string;
  managedBy: ServiceManagedBy;
  pid: number | null;
  startedAt: number | null;
  uptimeSeconds: number | null;
  lastExitCode: number | null;
  lastError: string | null;
  health: ServiceHealth | null;
  logPath: string;
}

export interface LogPage {
  id: string;
  logPath: string;
  lines: string[];
  truncated: boolean;
  error: string | null;
}

export interface ServiceActionResponse {
  service: ServiceState;
  message: string;
}

export interface ApiErrorResponse {
  error: string;
  detail?: string;
}
