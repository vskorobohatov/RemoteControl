import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { UpdateStatus } from "../types.js";

export class UpdateStatusStore {
  public constructor(private readonly filePath: string) {}

  read(): UpdateStatus | null {
    if (!existsSync(this.filePath)) {
      return null;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as unknown;
      return isUpdateStatus(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  write(status: UpdateStatus): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(status, null, 2)}\n`, "utf8");
    renameSync(temporary, this.filePath);
  }

  /** Forgets the recorded state and any temporary file a crashed write left behind. */
  clear(): void {
    const directory = path.dirname(this.filePath);
    const base = path.basename(this.filePath);
    rmSync(this.filePath, { force: true });
    if (!existsSync(directory)) {
      return;
    }
    for (const entry of readdirSync(directory)) {
      if (entry !== base && entry.startsWith(`${base}.`) && entry.endsWith(".tmp")) {
        rmSync(path.join(directory, entry), { force: true });
      }
    }
  }
}

function isUpdateStatus(value: unknown): value is UpdateStatus {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as UpdateStatus).phase === "string" &&
    typeof (value as UpdateStatus).currentVersion === "string"
  );
}
