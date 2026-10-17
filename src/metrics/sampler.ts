import type { MetricsConfig } from "../config.js";
import { EventBus } from "../lib/bus.js";
import { CpuSampler } from "./cpu.js";
import { GpuSampler } from "./gpu.js";
import { readMemoryMetrics } from "./memory.js";
import { MetricsStore } from "./store.js";
import type { MetricsSnapshot } from "../types.js";

export class MetricsSampler {
  private readonly cpu: CpuSampler;
  private readonly gpu: GpuSampler;
  private timer: NodeJS.Timeout | null = null;
  private collecting = false;
  private lastFallbackAt = 0;

  constructor(
    private readonly config: MetricsConfig,
    private readonly store: MetricsStore,
    private readonly bus: EventBus,
  ) {
    this.cpu = new CpuSampler(config.cpu);
    this.gpu = new GpuSampler(config.gpu);
  }

  async collect(): Promise<MetricsSnapshot> {
    const now = Date.now();
    const fallbackDue = now - this.lastFallbackAt >= this.config.gpu.rocmSmiIntervalMs;
    const gpu = await this.gpu.read(fallbackDue);
    if (gpu.source === "rocm-smi") {
      this.lastFallbackAt = now;
    }

    const snapshot: MetricsSnapshot = {
      t: now,
      cpu: this.cpu.read(),
      memory: readMemoryMetrics(),
      gpu,
    };

    this.store.push(snapshot);
    this.bus.publish("metrics", snapshot);
    return snapshot;
  }

  start(): void {
    if (this.timer !== null) {
      return;
    }
    this.timer = setInterval(() => {
      void this.collectSafe();
    }, this.config.sampleIntervalMs);
    void this.collectSafe();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async collectSafe(): Promise<void> {
    if (this.collecting) {
      return;
    }
    this.collecting = true;
    try {
      await this.collect();
    } catch (error) {
      this.bus.publish("notice", { level: "warn", message: `metrics collection failed: ${String(error)}` });
    } finally {
      this.collecting = false;
    }
  }
}
