import { PageColumn, PageGrid } from "@app/layouts/PageLayout";
import { useRemoteControlContext } from "@app/providers/RemoteControlContext";
import { MetricsPanel } from "@features/metrics/components/MetricsPanel";
import { formatClock } from "@shared/lib/format";
import { Counter } from "@shared/ui/Status";

export function MonitorPage() {
  const rc = useRemoteControlContext();
  const last = rc.series.at(-1);

  return (
    <PageGrid single>
      <PageColumn
        title="Monitor"
        counters={
          <>
            <Counter>{rc.series.length} samples</Counter>
            <Counter>interval {rc.sampleIntervalMs === null ? "—" : Math.round(rc.sampleIntervalMs) + "ms"}</Counter>
            <Counter>last {formatClock(last?.t ?? null)}</Counter>
          </>
        }
      >
        <MetricsPanel series={rc.series} layout="grid" />
      </PageColumn>
    </PageGrid>
  );
}
