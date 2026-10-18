import { EmptyState } from "@shared/ui/Actions";
import { Facts } from "@shared/ui/Facts";
import { Panel, PanelHeader } from "@shared/ui/Panel";
import { formatBytes, formatClock, formatUptime } from "@shared/lib/format";
import type { SystemResponse } from "../api";

interface RuntimePanelProps {
  system: SystemResponse | null;
  sampleIntervalMs: number | null;
}

export function RuntimePanel({ system, sampleIntervalMs }: RuntimePanelProps) {
  if (system === null) {
    return (
      <Panel>
        <PanelHeader title="Runtime" />
        <EmptyState variant="inline">waiting for the system report…</EmptyState>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelHeader title="Runtime" meta={"v" + system.appVersion} />
      <Facts
        items={[
          { label: "host", value: system.hostname },
          { label: "kernel", value: system.kernel },
          { label: "cpu", value: system.cpuModel + " · " + system.logicalCores + " cores" },
          { label: "memory", value: formatBytes(system.memoryTotalBytes) },
          { label: "gpu", value: system.gpuModel ?? "none detected" },
          {
            label: "server up since",
            value: formatClock(system.startedAt) + " · " + formatUptime(system.uptimeSeconds),
          },
          { label: "config", value: system.server.configPath },
          {
            label: "sample interval",
            value: sampleIntervalMs === null ? "—" : Math.round(sampleIntervalMs) + "ms",
          },
        ]}
      />
    </Panel>
  );
}
