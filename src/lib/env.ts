import { existsSync, readFileSync } from "node:fs";

const QUOTE_CHARS = new Set(['"', "'"]);

export function loadDotEnv(filePath: string): void {
  if (!existsSync(filePath)) {
    return;
  }
  for (const rawLine of readFileSync(filePath, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && QUOTE_CHARS.has(value[0]!) && QUOTE_CHARS.has(value[value.length - 1]!)) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
