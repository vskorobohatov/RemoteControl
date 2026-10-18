import { EmptyState } from "@shared/ui/Actions";
import { classnames } from "@shared/ui/controls";
import { Facts } from "@shared/ui/Facts";
import { Panel, PanelHeader } from "@shared/ui/Panel";
import { formatBytes, formatClock, formatLoad, formatNumber, formatPercent } from "@shared/lib/format";
import { CoreBars } from "./CoreBars";
import { Gauge } from "./Gauge";
import { Sparkline } from "./Sparkline";
import styles from "./MetricsPanel.module.scss";
import type { MetricsSnapshot } from "@server/types";

export function MetricsPanel({ series }: { series: MetricsSnapshot[] }) {
  const latest = series.at(-1);
  const cpuSeries = series.map((point) => point.cpu.totalPercent);
  const gpuSeries = series.map((point) => point.gpu.busyPercent ?? 0);

  if (latest === undefined) {
    return (
      <Panel>
        <PanelHeader title="Telemetry" />
        <EmptyState variant="inline">waiting for the first sample…</EmptyState>
      </Panel>
    );
  }

  const { cpu, memory, gpu } = latest;

  return (
    <div className={styles.stack}>
      <Panel>
        <PanelHeader title="CPU" meta={formatClock(latest.t)} />
        <Readout value={formatPercent(cpu.totalPercent)} unit="total load" tone="primary" />
        <Sparkline values={cpuSeries} ceiling={100} tone="primary" />
        <CoreBars values={cpu.perCorePercent} />
        <Facts
          items={[
            { label: "load 1/5/15", value: formatLoad(cpu.loadAvg) },
            { label: "core temp", value: cpu.temperatureC === null ? "—" : `${cpu.temperatureC.toFixed(1)} °C` },
          ]}
        />
      </Panel>

      <Panel>
        <PanelHeader title="Memory" meta={`${formatBytes(memory.availableBytes)} free`} />
        <Gauge label="RAM" used={memory.usedBytes} total={memory.totalBytes} format={formatBytes} />
        <Gauge label="Swap" used={memory.swapUsedBytes} total={memory.swapTotalBytes} format={formatBytes} />
      </Panel>

      <Panel>
        <PanelHeader title="GPU" meta={gpu.model ?? gpu.source} />
        {gpu.present ? (
          <>
            <Readout value={formatPercent(gpu.busyPercent)} unit="busy" tone="accent" />
            <Sparkline values={gpuSeries} ceiling={100} tone="accent" />
            <Gauge label="VRAM" used={gpu.vramUsedBytes} total={gpu.vramTotalBytes} format={formatBytes} />
            <Facts
              items={[
                { label: "power", value: gpu.powerWatts === null ? "—" : `${formatNumber(gpu.powerWatts, 1)} W` },
                { label: "junction", value: formatTemperature(gpu.temperaturesC) },
                { label: "clocks", value: formatClocks(gpu.clocksMHz) },
              ]}
            />
          </>
        ) : (
          <EmptyState variant="inline">no GPU source detected (sysfs / rocm-smi unavailable)</EmptyState>
        )}
      </Panel>
    </div>
  );
}

function Readout({ value, unit, tone }: { value: string; unit: string; tone: "primary" | "accent" }) {
  return (
    <div className={styles.readout}>
      <span className={classnames(styles.readoutValue, tone === "accent" ? styles.readoutAccent : styles.readoutPrimary)}>
        {value}
      </span>
      <span className={styles.readoutUnit}>{unit}</span>
    </div>
  );
}

function formatTemperature(temps: Record<string, number>): string {
  const entries = Object.entries(temps);
  if (entries.length === 0) {
    return "—";
  }
  const hottest = entries.reduce((best, current) => (current[1] > best[1] ? current : best));
  return `${hottest[1].toFixed(0)} °C (${hottest[0]})`;
}

function formatClocks(clocks: Record<string, number>): string {
  const entries = Object.entries(clocks);
  if (entries.length === 0) {
    return "—";
  }
  return entries.map(([key, value]) => `${key} ${value} MHz`).join(" · ");
}
