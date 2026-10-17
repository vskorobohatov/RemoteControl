import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const HWMON_ROOT = "/sys/class/hwmon";
const DRM_ROOT = "/sys/class/drm";

export function readSysfsText(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8").trim();
  } catch {
    return null;
  }
}

export function readSysfsNumber(filePath: string): number | null {
  const raw = readSysfsText(filePath);
  if (raw === null) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function listEntries(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

export interface HwmonDevice {
  dir: string;
  name: string;
}

export function listHwmonDevices(root: string = HWMON_ROOT): HwmonDevice[] {
  const devices: HwmonDevice[] = [];
  for (const entry of listEntries(root)) {
    const dir = path.join(root, entry);
    const name = readSysfsText(path.join(dir, "name"));
    if (name !== null) {
      devices.push({ dir, name });
    }
  }
  return devices;
}

export function findHwmonByName(name: string, root: string = HWMON_ROOT): string | null {
  for (const device of listHwmonDevices(root)) {
    if (device.name === name) {
      return device.dir;
    }
  }
  return null;
}

/** Temperatures in degrees C, keyed by the hwmon label (Tctl, edge, junction, mem, ...). */
export function readHwmonTemperatures(dir: string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const entry of listEntries(dir)) {
    const match = entry.match(/^temp(\d+)_input$/);
    if (!match) {
      continue;
    }
    const value = readSysfsNumber(path.join(dir, entry));
    if (value === null) {
      continue;
    }
    const index = match[1]!;
    const label = readSysfsText(path.join(dir, `temp${index}_label`)) ?? `temp${index}`;
    result[label] = value / 1000;
  }
  return result;
}

/** Package power in watts; amdgpu exposes power1_average, other drivers power1_input. */
export function readHwmonPower(dir: string): number | null {
  for (const suffix of ["average", "input"] as const) {
    for (const entry of listEntries(dir)) {
      if (!new RegExp(`^power\\d+_${suffix}$`).test(entry)) {
        continue;
      }
      const value = readSysfsNumber(path.join(dir, entry));
      if (value !== null) {
        return value / 1_000_000;
      }
    }
  }
  return null;
}

/** Clock frequencies in MHz, keyed by the hwmon label (sclk, mclk, ...). */
export function readHwmonFrequencies(dir: string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const entry of listEntries(dir)) {
    const match = entry.match(/^freq(\d+)_input$/);
    if (!match) {
      continue;
    }
    const value = readSysfsNumber(path.join(dir, entry));
    if (value === null) {
      continue;
    }
    const index = match[1]!;
    const label = readSysfsText(path.join(dir, `freq${index}_label`)) ?? `freq${index}`;
    result[label] = Math.round(value / 1_000_000);
  }
  return result;
}

export function readHwmonName(dir: string): string | null {
  return readSysfsText(path.join(dir, "name"));
}

/** DRM card device directories that expose AMD VRAM sysfs nodes. */
export function listGpuCardDevices(): string[] {
  const cards: string[] = [];
  for (const entry of listEntries(DRM_ROOT)) {
    if (!/^card\d+$/.test(entry)) {
      continue;
    }
    const deviceDir = path.join(DRM_ROOT, entry, "device");
    if (existsSync(path.join(deviceDir, "mem_info_vram_total"))) {
      cards.push(deviceDir);
    }
  }
  return cards.sort();
}

export function readPciDeviceId(deviceDir: string): string | null {
  return readSysfsText(path.join(deviceDir, "device"));
}

export function readGpuProductName(deviceDir: string): string | null {
  return readSysfsText(path.join(deviceDir, "product_name"));
}

export function hwmonDirsForDevice(deviceDir: string): string[] {
  const hwmonRoot = path.join(deviceDir, "hwmon");
  return listEntries(hwmonRoot)
    .filter((entry) => /^hwmon\d+$/.test(entry))
    .map((entry) => path.join(hwmonRoot, entry));
}
