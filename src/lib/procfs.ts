import { readFileSync } from "node:fs";

export interface CpuTimes {
  busy: number;
  total: number;
}

export interface CpuStatSnapshot {
  aggregate: CpuTimes;
  perCore: CpuTimes[];
}

export interface MemoryStat {
  totalBytes: number;
  availableBytes: number;
  swapTotalBytes: number;
  swapFreeBytes: number;
}

const toNumber = (value: string | undefined): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function parseProcStat(content: string): CpuStatSnapshot {
  const aggregate: CpuTimes = { busy: 0, total: 0 };
  const perCore: CpuTimes[] = [];

  for (const line of content.split("\n")) {
    if (!line.startsWith("cpu")) {
      continue;
    }
    const parts = line.trim().split(/\s+/);
    const label = parts[0] ?? "";
    const fields = parts.slice(1).map(toNumber);
    const total = fields.reduce((sum, value) => sum + value, 0);
    // /proc/stat columns: user nice system idle iowait irq softirq steal guest guest_nice
    const idle = (fields[3] ?? 0) + (fields[4] ?? 0);
    const sample: CpuTimes = { busy: total - idle, total };

    if (label === "cpu") {
      aggregate.busy = sample.busy;
      aggregate.total = sample.total;
    } else if (/^cpu\d+$/.test(label)) {
      perCore.push(sample);
    }
  }

  return { aggregate, perCore };
}

export function usagePercent(previous: CpuTimes, current: CpuTimes): number {
  const deltaTotal = current.total - previous.total;
  if (deltaTotal <= 0) {
    return 0;
  }
  const deltaBusy = current.busy - previous.busy;
  return Math.max(0, Math.min(100, (deltaBusy / deltaTotal) * 100));
}

export function parseLoadAvg(content: string): [number, number, number] {
  const parts = content.trim().split(/\s+/);
  return [toNumber(parts[0]), toNumber(parts[1]), toNumber(parts[2])];
}

export function parseMemInfo(content: string): MemoryStat {
  const values = new Map<string, number>();
  for (const line of content.split("\n")) {
    const match = line.match(/^(\w+):\s+(\d+)\s*kB/);
    if (match) {
      values.set(match[1]!, Number(match[2]) * 1024);
    }
  }

  const totalBytes = values.get("MemTotal") ?? 0;
  const availableBytes = values.get("MemAvailable") ?? values.get("MemFree") ?? 0;

  return {
    totalBytes,
    availableBytes,
    swapTotalBytes: values.get("SwapTotal") ?? 0,
    swapFreeBytes: values.get("SwapFree") ?? 0,
  };
}

export function parseCpuModel(content: string): string {
  for (const line of content.split("\n")) {
    const match = line.match(/^model name\s*:\s*(.+)$/);
    if (match) {
      return match[1]!.trim();
    }
  }
  return "unknown CPU";
}

export const readProcStat = (): string => readFileSync("/proc/stat", "utf8");
export const readProcLoadAvg = (): string => readFileSync("/proc/loadavg", "utf8");
export const readProcMemInfo = (): string => readFileSync("/proc/meminfo", "utf8");
export const readProcCpuinfo = (): string => readFileSync("/proc/cpuinfo", "utf8");
export const readProcUptime = (): string => readFileSync("/proc/uptime", "utf8");

export function readUptimeSeconds(): number {
  return toNumber(readProcUptime().split(/\s+/)[0]);
}
