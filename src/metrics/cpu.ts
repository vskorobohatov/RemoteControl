import { findHwmonByName, readHwmonTemperatures } from "../lib/sysfs.js";
import {
  parseLoadAvg,
  parseProcStat,
  readProcLoadAvg,
  readProcStat,
  usagePercent,
  type CpuStatSnapshot,
  type CpuTimes,
} from "../lib/procfs.js";
import type { MetricsConfig } from "../config.js";
import type { CpuMetrics } from "../types.js";

export class CpuSampler {
  private previous: CpuStatSnapshot | null = null;
  private hwmonDir: string | null | undefined = undefined;

  constructor(private readonly config: MetricsConfig["cpu"]) {}

  private resolveHwmon(): string | null {
    if (this.hwmonDir === undefined) {
      this.hwmonDir = findHwmonByName(this.config.hwmonLabel);
    }
    return this.hwmonDir;
  }

  private readTemperatureC(): number | null {
    const dir = this.resolveHwmon();
    if (dir === null) {
      return null;
    }
    const temperatures = readHwmonTemperatures(dir);
    const preferred = temperatures["Tctl"] ?? temperatures["Tdie"];
    if (preferred !== undefined) {
      return preferred;
    }
    const values = Object.values(temperatures);
    if (values.length === 0) {
      return null;
    }
    return Math.max(...values);
  }

  read(): CpuMetrics {
    const current = parseProcStat(readProcStat());
    const previous = this.previous;
    this.previous = current;

    const totalPercent = previous === null ? 0 : usagePercent(previous.aggregate, current.aggregate);
    const perCorePercent = previous === null || previous.perCore.length !== current.perCore.length
      ? current.perCore.map(() => 0)
      : current.perCore.map((core: CpuTimes, index) => usagePercent(previous.perCore[index]!, core));

    return {
      totalPercent: round1(totalPercent),
      perCorePercent: perCorePercent.map((value) => round1(value)),
      loadAvg: parseLoadAvg(readProcLoadAvg()),
      temperatureC: this.readTemperatureC(),
    };
  }
}

const round1 = (value: number): number => Math.round(value * 10) / 10;
