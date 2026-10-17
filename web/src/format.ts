export function formatBytes(value: number | null): string {
  if (value === null) {
    return "—";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const digits = size >= 100 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(digits)} ${units[unit] ?? "B"}`;
}

export function formatPercent(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

export function formatNumber(value: number | null, digits = 0): string {
  return value === null ? "—" : value.toFixed(digits);
}

export function formatUptime(seconds: number | null): string {
  if (seconds === null) {
    return "—";
  }
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(secs).padStart(2, "0")}s`;
  }
  return `${secs}s`;
}

export function formatClock(timestamp: number | null): string {
  if (timestamp === null) {
    return "—";
  }
  return new Date(timestamp).toLocaleTimeString([], { hour12: false });
}

export function formatLoad(load: [number, number, number]): string {
  return load.map((value) => value.toFixed(2)).join(" · ");
}
