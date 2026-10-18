import { readFileSync } from "node:fs";
import path from "node:path";

export const UNKNOWN_VERSION = "0.0.0";

export function readAppVersion(rootDir: string): string {
  try {
    const raw = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8")) as { version?: unknown };
    return typeof raw.version === "string" && raw.version.length > 0 ? raw.version : UNKNOWN_VERSION;
  } catch {
    return UNKNOWN_VERSION;
  }
}
