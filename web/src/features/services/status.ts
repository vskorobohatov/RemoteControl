import type { ServiceStatus } from "@server/types";
import type { Tone } from "@shared/ui/controls";

export const STATUS_TONE: Record<ServiceStatus, Tone | null> = {
  stopped: null,
  starting: "warn",
  running: "ok",
  ready: "ok",
  degraded: "warn",
  stopping: "warn",
  failed: "danger",
  external: "external",
};

export const TRANSITIONAL: ReadonlySet<ServiceStatus> = new Set(["starting", "stopping"]);
