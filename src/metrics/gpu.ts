import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  hwmonDirsForDevice,
  listGpuCardDevices,
  readGpuProductName,
  readHwmonFrequencies,
  readHwmonName,
  readHwmonPower,
  readHwmonTemperatures,
  readPciDeviceId,
  readSysfsNumber,
} from "../lib/sysfs.js";
import type { GpuConfig } from "../config.js";
import type { GpuMetrics } from "../types.js";

const ROCM_SMI_ARGS = ["--json", "--showuse", "--showmeminfo", "vram", "--showtemp", "--showpower"];

const emptyMetrics = (): GpuMetrics => ({
  present: false,
  source: "none",
  model: null,
  busyPercent: null,
  vramTotalBytes: null,
  vramUsedBytes: null,
  temperaturesC: {},
  powerWatts: null,
  clocksMHz: {},
});

const asNumber = (value: unknown): number | null => {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
};

function runRocmSmi(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("rocm-smi", ROCM_SMI_ARGS, { timeout: 10_000 }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

export class GpuSampler {
  private deviceDir: string | null | undefined;
  private hwmonDir: string | null | undefined;
  private model: string | null | undefined;

  constructor(private readonly config: GpuConfig) {}

  private resolveDevice(): string | null {
    if (this.deviceDir !== undefined) {
      return this.deviceDir;
    }

    let candidates: string[] = [];
    if (this.config.cardPath !== "") {
      const configured = this.config.cardPath.endsWith("/device")
        ? this.config.cardPath
        : path.join(this.config.cardPath, "device");
      if (existsSync(path.join(configured, "mem_info_vram_total"))) {
        candidates = [configured];
      }
    } else {
      candidates = listGpuCardDevices();
    }

    if (this.config.expectPciDevice !== null) {
      const matching = candidates.filter((dir) => readPciDeviceId(dir) === this.config.expectPciDevice);
      if (matching.length > 0) {
        candidates = matching;
      }
    }

    this.deviceDir = candidates[0] ?? null;
    this.hwmonDir =
      this.deviceDir === null
        ? null
        : (hwmonDirsForDevice(this.deviceDir).find((dir) => readHwmonName(dir) === "amdgpu") ??
          hwmonDirsForDevice(this.deviceDir)[0] ??
          null);
    this.model = this.describeDevice(this.deviceDir);
    return this.deviceDir;
  }

  private describeDevice(deviceDir: string | null): string | null {
    if (deviceDir === null) {
      return null;
    }
    const productName = readGpuProductName(deviceDir);
    if (productName !== null) {
      return productName;
    }
    const pciId = readPciDeviceId(deviceDir);
    return pciId === null ? "unknown GPU" : `GPU ${pciId}`;
  }

  readSysfs(): GpuMetrics | null {
    const deviceDir = this.resolveDevice();
    if (deviceDir === null) {
      return null;
    }

    const busyPercent = readSysfsNumber(path.join(deviceDir, "gpu_busy_percent"));
    const vramTotalBytes = readSysfsNumber(path.join(deviceDir, "mem_info_vram_total"));
    const vramUsedBytes = readSysfsNumber(path.join(deviceDir, "mem_info_vram_used"));
    if (busyPercent === null && vramTotalBytes === null) {
      return null;
    }

    const hwmonDir = this.hwmonDir ?? null;
    return {
      present: true,
      source: "sysfs",
      model: this.model ?? null,
      busyPercent,
      vramTotalBytes,
      vramUsedBytes,
      temperaturesC: hwmonDir === null ? {} : readHwmonTemperatures(hwmonDir),
      powerWatts: hwmonDir === null ? null : readHwmonPower(hwmonDir),
      clocksMHz: hwmonDir === null ? {} : readHwmonFrequencies(hwmonDir),
    };
  }

  async readRocmSmi(): Promise<GpuMetrics | null> {
    try {
      const output = await runRocmSmi();
      const parsed = JSON.parse(output) as Record<string, Record<string, unknown>>;
      const card = Object.values(parsed).find((entry) => typeof entry === "object" && entry !== null);
      if (!card) {
        return null;
      }

      const metrics = emptyMetrics();
      for (const [key, rawValue] of Object.entries(card)) {
        const value = asNumber(rawValue);
        if (value === null) {
          continue;
        }
        if (/GPU use \(%\)/.test(key)) {
          metrics.busyPercent = value;
        } else if (/VRAM Total Memory \(B\)/.test(key)) {
          metrics.vramTotalBytes = value;
        } else if (/VRAM Total Used Memory \(B\)/.test(key)) {
          metrics.vramUsedBytes = value;
        } else if (/Temperature/.test(key)) {
          metrics.temperaturesC[key] = value;
        } else if (/Power/.test(key)) {
          metrics.powerWatts = value;
        }
      }

      if (metrics.busyPercent === null && metrics.vramTotalBytes === null) {
        return null;
      }

      metrics.present = true;
      metrics.source = "rocm-smi";
      metrics.model = this.model ?? this.describeDevice(this.resolveDevice());
      return metrics;
    } catch {
      return null;
    }
  }

  async read(useFallback: boolean): Promise<GpuMetrics> {
    const sysfs = this.readSysfs();
    if (sysfs !== null) {
      return sysfs;
    }
    if (useFallback && this.config.rocmSmiFallback) {
      const fromRocm = await this.readRocmSmi();
      if (fromRocm !== null) {
        return fromRocm;
      }
    }
    return emptyMetrics();
  }
}
