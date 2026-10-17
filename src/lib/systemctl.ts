import { spawn } from "node:child_process";
import { readUptimeSeconds } from "./procfs.js";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function runCommand(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} ${args.join(" ")} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

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
