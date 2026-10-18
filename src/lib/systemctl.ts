import { runCommand } from "./run.js";
import type { CommandResult } from "./run.js";
import { readUptimeSeconds } from "./procfs.js";

export const runSystemctl = (args: string[], timeoutMs: number): Promise<CommandResult> =>
  runCommand("systemctl", ["--user", ...args], timeoutMs);


export function parsePropertyOutput(stdout: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of stdout.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) {
      values.set(line.slice(0, eq), line.slice(eq + 1));
    }
  }
  return values;
}

/** systemd reports monotonic timestamps in microseconds since boot. */
export function monotonicToWallClock(microseconds: number): number {
  const bootTimeMs = Date.now() - readUptimeSeconds() * 1000;
  return Math.round(bootTimeMs + microseconds / 1000);
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
