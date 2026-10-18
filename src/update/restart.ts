import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { runCommand } from "../lib/run.js";
import type { RestartMode } from "../types.js";

export const RESTART_MODE_ENV = "RC_UPDATE_RESTART_MODE";
export const SERVER_PID_ENV = "RC_UPDATE_SERVER_PID";
export const ROOT_DIR_ENV = "RC_UPDATE_ROOT_DIR";
export const RUNNER_UNIT = "rc-update.scope";

const STOP_POLL_MS = 500;
const STOP_TIMEOUT_MS = 20_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * A systemd unit is the only reliable way to bring the server back when the update
 * itself runs inside the server's cgroup. Without one, a plain `npm start` process
 * relaunches itself; a watcher session (tsx watch) restarts on its own once the
 * pulled sources change, so the runner must not spawn a competing server.
 */
export function resolveRestartMode(restartUnit: string | null): RestartMode {
  if (restartUnit !== null && restartUnit.trim().length > 0) {
    return "systemd-unit";
  }
  return isWatchSession() ? "none" : "relaunch";
}

function isWatchSession(): boolean {
  const entry = process.argv[1] ?? "";
  return process.argv.some((arg) => arg.includes("tsx")) || /\.(m?ts|tsx)$/.test(entry);
}

export function parseRestartMode(value: string | undefined): RestartMode {
  return value === "systemd-unit" || value === "none" ? value : "relaunch";
}

export function runnerInvocation(rootDir: string): { command: string; args: string[] } | null {
  const compiled = path.join(rootDir, "dist", "server", "update", "runner.js");
  if (existsSync(compiled)) {
    return { command: process.execPath, args: [compiled] };
  }
  const tsx = path.join(rootDir, "node_modules", ".bin", "tsx");
  const source = path.join(rootDir, "src", "update", "runner.ts");
  if (existsSync(tsx) && existsSync(source)) {
    return { command: tsx, args: [source] };
  }
  return null;
}

export interface RestartRequest {
  mode: RestartMode;
  rootDir: string;
  restartUnit: string | null;
  serverPid: number;
}

export async function applyRestart(request: RestartRequest): Promise<string> {
  if (request.mode === "none") {
    return "restart left to the process supervisor watching this server";
  }

  if (request.mode === "systemd-unit") {
    const unit = request.restartUnit ?? "";
    if (unit.length === 0) {
      return "no update.restart_unit configured";
    }
    const result = await runCommand("systemctl", ["--user", "restart", unit], 30_000).catch(
      (error: unknown) => ({ code: -1, stdout: "", stderr: String(error) }),
    );
    return result.code === 0
      ? `restarted ${unit}`
      : `systemctl --user restart ${unit} failed: ${(result.stderr || result.stdout).trim()}`;
  }

  const stopped = await stopServer(request.serverPid);
  if (!stopped) {
    return "the previous server did not stop in time; skipped relaunch";
  }
  return relaunchServer(request.rootDir);
}

async function stopServer(pid: number): Promise<boolean> {
  if (pid <= 0 || !isAlive(pid)) {
    return true;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return !isAlive(pid);
  }

  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) {
      return true;
    }
    await sleep(STOP_POLL_MS);
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return !isAlive(pid);
  }
  await sleep(STOP_POLL_MS);
  return !isAlive(pid);
}

function relaunchServer(rootDir: string): string {
  const entry = path.join(rootDir, "dist", "server", "index.js");
  if (!existsSync(entry)) {
    return `${entry} is missing; run npm run build before updating`;
  }

  const child = spawn(process.execPath, [entry], {
    cwd: rootDir,
    env: process.env,
    stdio: "inherit",
    detached: true,
  });
  child.once("error", () => undefined);
  child.unref();
  return `started ${entry}`;
}
