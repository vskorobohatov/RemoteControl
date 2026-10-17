import { spawn, type ChildProcess } from "node:child_process";
import { monotonicToWallClock, parsePropertyOutput, runSystemctl, sleep } from "../lib/systemctl.js";

export interface UnitProperties {
  activeState: string;
  subState: string;
  startedAtMs: number | null;
}

export interface ServiceExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface StartUnitRequest {
  unit: string;
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
  logPath: string;
  killSignal: string;
  timeoutStopSec: number;
  onExit: (exit: ServiceExit) => void;
}

export interface StartUnitResult {
  ok: boolean;
  error: string | null;
  supervisor: ChildProcess | null;
}

const ACTIVE_POLL_INTERVAL_MS = 250;
const ACTIVE_POLL_TIMEOUT_MS = 10_000;

const IDLE_PROPS: UnitProperties = { activeState: "unknown", subState: "unknown", startedAtMs: null };

/**
 * Transient scopes are only addressable with their explicit ".scope" suffix:
 * a bare name makes systemctl fall back to the ".service" suffix and report the unit as unknown.
 */
export function scopeUnitName(unit: string): string {
  return unit.includes(".") ? unit : `${unit}.scope`;
}

export class SystemdSupervisor {
  /**
   * Starts a transient scope and resolves once systemd reports it active. The
   * systemd-run process stays alive as a detached supervisor so the command's
   * exit status is observable and the unit outlives this server process.
   */
  async startUnit(request: StartUnitRequest): Promise<StartUnitResult> {
    const unit = scopeUnitName(request.unit);
    const supervisor = this.spawnSupervisor(request, unit);
    const failure = await this.waitForActive(unit, supervisor);
    if (failure !== null) {
      return { ok: false, error: failure, supervisor: null };
    }
    return { ok: true, error: null, supervisor };
  }

  private spawnSupervisor(request: StartUnitRequest, unit: string): ChildProcess {
    const args = [
      "--user",
      "--scope",
      "--unit",
      unit,
      "--collect",
      "--property",
      `KillSignal=${request.killSignal}`,
      "--property",
      "KillMode=control-group",
      "--property",
      `TimeoutStopSec=${request.timeoutStopSec}`,
      "--setenv",
      `RC_LOG_PATH=${request.logPath}`,
    ];

    if (request.cwd !== undefined) {
      args.push("--working-directory", request.cwd);
    }
    for (const [key, value] of Object.entries(request.env)) {
      args.push("--setenv", `${key}=${value}`);
    }

    /* The "_" placeholder keeps "$@" aligned with the real command. */
    args.push("sh", "-c", 'exec "$@" >>"$RC_LOG_PATH" 2>&1', "_", request.command, ...request.args);

    const child = spawn("systemd-run", args, { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.resume();
    child.stderr.resume();
    /* Registered before any await so a fast-exiting command cannot miss its exit event. */
    child.once("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      request.onExit({ code, signal });
    });
    child.unref();
    return child;
  }

  private async waitForActive(unit: string, supervisor: ChildProcess): Promise<string | null> {
    const deadline = Date.now() + ACTIVE_POLL_TIMEOUT_MS;
    let stderr = "";
    supervisor.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    while (Date.now() < deadline) {
      if (await this.isActive(unit)) {
        return null;
      }
      if (supervisor.exitCode !== null) {
        return stderr.trim() || `systemd-run exited with code ${supervisor.exitCode}`;
      }
      await sleep(ACTIVE_POLL_INTERVAL_MS);
    }

    supervisor.kill("SIGTERM");
    return `unit ${unit} did not become active within ${ACTIVE_POLL_TIMEOUT_MS / 1000}s`;
  }

  async isActive(unit: string): Promise<boolean> {
    try {
      return (await runSystemctl(["is-active", scopeUnitName(unit)], 5_000)).stdout.trim() === "active";
    } catch {
      return false;
    }
  }

  async unitProperties(unit: string): Promise<UnitProperties> {
    try {
      const result = await runSystemctl(
        ["show", scopeUnitName(unit), "-p", "ActiveState", "-p", "SubState", "-p", "ActiveEnterTimestampMonotonic"],
        5_000,
      );
      const values = parsePropertyOutput(result.stdout);
      const activeState = values.get("ActiveState") ?? "unknown";
      const subState = values.get("SubState") ?? "unknown";
      const monotonic = Number(values.get("ActiveEnterTimestampMonotonic"));
      const startedAtMs =
        activeState === "active" && Number.isFinite(monotonic) && monotonic > 0
          ? monotonicToWallClock(monotonic)
          : null;
      return { activeState, subState, startedAtMs };
    } catch {
      return IDLE_PROPS;
    }
  }

  /** Transient scopes do not expose MainPID, so read it from the cgroup tree. */
  async unitPid(unit: string): Promise<number | null> {
    try {
      const result = await runSystemctl(["status", scopeUnitName(unit), "--no-pager", "--full"], 5_000);
      const match = result.stdout.match(/[─├└]─?\s*(\d{1,8})\s+\S/);
      const pid = match === null ? Number.NaN : Number(match[1]);
      return Number.isFinite(pid) ? pid : null;
    } catch {
      return null;
    }
  }

  async stopUnit(unit: string, graceSeconds: number): Promise<{ ok: boolean; error: string | null }> {
    try {
      const result = await runSystemctl(["stop", scopeUnitName(unit)], graceSeconds * 1000 + 5_000);
      if (result.code === 0 || result.stderr.includes("not loaded")) {
        return { ok: true, error: null };
      }
      return {
        ok: false,
        error: result.stderr.trim() || `systemctl stop exited with code ${result.code}`,
      };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  }
}
