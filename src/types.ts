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
  link: string | null;
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

/* ---------------------------------------------------------------------------
 * Users, roles and sessions. The server is the only place that decides what a
 * role may do; the client receives the resulting permission list with the session
 * so it hides exactly what it would otherwise be refused.
 * ------------------------------------------------------------------------ */

export type UserRole = "admin" | "manager" | "guest";

export const USER_ROLES: readonly UserRole[] = ["admin", "manager", "guest"];

export type Permission =
  | "services:view"
  | "services:control"
  | "services:logs"
  | "metrics:view"
  | "update:view"
  | "update:apply"
  | "users:manage";

/** A user as the client may see it - never the password hash. */
export interface PublicUser {
  id: number;
  login: string;
  role: UserRole;
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
}

export interface AuthStatusResponse {
  /** True until the first admin account exists; the UI turns this into a setup form. */
  needsBootstrap: boolean;
}

export interface LoginResponse {
  token: string;
  expiresAt: number;
  user: PublicUser;
  permissions: Permission[];
}

export interface SessionResponse {
  user: PublicUser;
  permissions: Permission[];
  expiresAt: number;
}

export interface UsersResponse {
  users: PublicUser[];
}

export interface CreateUserRequest {
  login: string;
  password: string;
  role: UserRole;
}

export interface UpdateUserRequest {
  login?: string;
  role?: UserRole;
  password?: string;
}


export type UpdatePhase =
  | "unknown"
  | "unavailable"
  | "checking"
  | "up-to-date"
  | "available"
  | "blocked"
  | "applying"
  | "restarting"
  | "failed";

export type UpdateRunStatus = "running" | "done" | "failed";

export type RestartMode = "systemd-unit" | "relaunch" | "none";

export interface ReleaseInfo {
  ref: string;
  branch: string;
  version: string;
}

export interface IncomingCommit {
  shortHash: string;
  author: string;
  date: string;
  subject: string;
}

export interface UpdateRunStep {
  at: number;
  label: string;
  ok: boolean;
  detail: string;
}

export interface UpdateRun {
  startedAt: number;
  finishedAt: number | null;
  status: UpdateRunStatus;
  targetBranch: string | null;
  fromVersion: string | null;
  toVersion: string | null;
  fromHead: string | null;
  toHead: string | null;
  steps: UpdateRunStep[];
  message: string | null;
}

export interface UpdateStatus {
  enabled: boolean;
  phase: UpdatePhase;
  checkedAt: number | null;
  currentVersion: string;
  remote: string;
  branch: string | null;
  upstream: string | null;
  localHead: string | null;
  dirty: boolean;
  ahead: number;
  behind: number;
  releases: ReleaseInfo[];
  target: ReleaseInfo | null;
  incomingCommits: IncomingCommit[];
  canApply: boolean;
  message: string | null;
  lastRun: UpdateRun | null;
}

export interface UpdateApplyResponse {
  message: string;
  status: UpdateStatus;
}
