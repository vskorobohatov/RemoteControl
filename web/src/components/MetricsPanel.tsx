import { CoreBars, Gauge, Sparkline } from "./Charts";
import { formatBytes, formatClock, formatLoad, formatNumber, formatPercent } from "../format";
import type { MetricsSnapshot } from "../../../src/types";

export function MetricsPanel({ series }: { series: MetricsSnapshot[] }) {
  const latest = series.at(-1);
  const cpuSeries = series.map((point) => point.cpu.totalPercent);
  const gpuSeries = series.map((point) => point.gpu.busyPercent ?? 0);

  if (latest === undefined) {
    return (
      <section className="panel">
        <h2 className="panel-title">Telemetry</h2>
        <p className="panel-empty">waiting for the first sample…</p>
      </section>
    );
  }

  const { cpu, memory, gpu } = latest;

  return (
    <div className="panel-stack">
      <section className="panel panel--cpu">
        <header className="panel-head">
          <h2 className="panel-title">CPU</h2>
          <span className="panel-clock">{formatClock(latest.t)}</span>
        </header>
        <div className="readout">
          <span className="readout-value readout-value--signal">{formatPercent(cpu.totalPercent)}</span>
          <span className="readout-unit">total load</span>
        </div>
        <Sparkline values={cpuSeries} ceiling={100} tone="signal" />
        <CoreBars values={cpu.perCorePercent} />
        <dl className="facts">
          <div>
            <dt>load 1/5/15</dt>
            <dd>{formatLoad(cpu.loadAvg)}</dd>
          </div>
          <div>
            <dt>core temp</dt>
            <dd>{cpu.temperatureC === null ? "—" : `${cpu.temperatureC.toFixed(1)} °C`}</dd>
          </div>
        </dl>
      </section>

      <section className="panel panel--memory">
        <header className="panel-head">
          <h2 className="panel-title">Memory</h2>
          <span className="panel-clock">{formatBytes(memory.availableBytes)} free</span>
        </header>
        <Gauge label="RAM" used={memory.usedBytes} total={memory.totalBytes} format={formatBytes} />
        <Gauge label="Swap" used={memory.swapUsedBytes} total={memory.swapTotalBytes} format={formatBytes} />
      </section>

      <section className="panel panel--gpu">
        <header className="panel-head">
          <h2 className="panel-title">GPU</h2>
          <span className="panel-clock">{gpu.model ?? gpu.source}</span>
        </header>
        {gpu.present ? (
          <>
            <div className="readout">
              <span className="readout-value readout-value--accent">{formatPercent(gpu.busyPercent)}</span>
              <span className="readout-unit">busy</span>
            </div>
            <Sparkline values={gpuSeries} ceiling={100} tone="accent" />
            <Gauge label="VRAM" used={gpu.vramUsedBytes} total={gpu.vramTotalBytes} format={formatBytes} />
            <dl className="facts">
              <div>
                <dt>power</dt>
                <dd>{gpu.powerWatts === null ? "—" : `${formatNumber(gpu.powerWatts, 1)} W`}</dd>
              </div>
              <div>
                <dt>junction</dt>
                <dd>{formatTemperature(gpu.temperaturesC)}</dd>
              </div>
              <div>
                <dt>clocks</dt>
                <dd>{formatClocks(gpu.clocksMHz)}</dd>
              </div>
            </dl>
          </>
        ) : (
          <p className="panel-empty">no GPU source detected (sysfs / rocm-smi unavailable)</p>
        )}
      </section>
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
