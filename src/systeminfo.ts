import os from "node:os";
import { parseCpuModel, readProcCpuinfo, readUptimeSeconds } from "./lib/procfs.js";
import { GpuSampler } from "./metrics/gpu.js";
import { readMemoryMetrics } from "./metrics/memory.js";
import type { SystemInfo } from "./types.js";

export async function collectSystemInfo(
  gpuSampler: GpuSampler,
  appVersion: string,
  startedAt: number,
): Promise<SystemInfo> {
  const gpu = gpuSampler.readSysfs() ?? (await gpuSampler.readRocmSmi());

  return {
    hostname: os.hostname(),
    kernel: os.release(),
    arch: `${os.arch()}-${os.platform()}`,
    appVersion,
    startedAt,
    uptimeSeconds: readUptimeSeconds(),
    cpuModel: parseCpuModel(readProcCpuinfo()),
    logicalCores: os.cpus().length,
    memoryTotalBytes: readMemoryMetrics().totalBytes,
    gpuModel: gpu?.model ?? null,
    vramTotalBytes: gpu?.vramTotalBytes ?? null,
  };
}
