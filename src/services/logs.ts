import { promises as fsp, statSync } from "node:fs";
import type { LogPage } from "../types.js";

const DEFAULT_MAX_BYTES = 64 * 1024;

const readTail = async (logPath: string, maxBytes: number): Promise<{ lines: string[]; truncated: boolean }> => {
  const size = statSync(logPath).size;
  const start = Math.max(0, size - maxBytes);
  const handle = await fsp.open(logPath, "r");
  try {
    const length = size - start;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    const text = buffer.toString("utf8");
    const lines = text.split("\n");
    if (start > 0) {
      /* The first line is likely cut in the middle. */
      lines.shift();
    }
    while (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }
    return { lines, truncated: start > 0 };
  } finally {
    await handle.close();
  }
};

export async function readServiceLog(
  id: string,
  logPath: string,
  maxBytes = DEFAULT_MAX_BYTES,
): Promise<LogPage> {
  try {
    const { lines, truncated } = await readTail(logPath, maxBytes);
    return { id, logPath, lines, truncated, error: null };
  } catch (error) {
    const message =
      error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT"
        ? "no log file yet"
        : `failed to read log: ${String(error)}`;
    return { id, logPath, lines: [], truncated: false, error: message };
  }
}
