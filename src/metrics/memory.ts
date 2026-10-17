import { parseMemInfo, readProcMemInfo } from "../lib/procfs.js";
import type { MemoryMetrics } from "../types.js";

export function readMemoryMetrics(): MemoryMetrics {
  const stat = parseMemInfo(readProcMemInfo());
  return {
    totalBytes: stat.totalBytes,
    availableBytes: stat.availableBytes,
    usedBytes: Math.max(0, stat.totalBytes - stat.availableBytes),
    swapTotalBytes: stat.swapTotalBytes,
    swapUsedBytes: Math.max(0, stat.swapTotalBytes - stat.swapFreeBytes),
  };
}
