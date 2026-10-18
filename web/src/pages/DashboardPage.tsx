import { PageColumn, PageGrid } from "@app/layouts/PageLayout";
import { useRemoteControlContext } from "@app/providers/RemoteControlContext";
import { MetricsPanel } from "@features/metrics/components/MetricsPanel";
import { ServiceList } from "@features/services/components/ServiceList";
import { NoticeList } from "@shared/ui/NoticeList";
import { Counter } from "@shared/ui/Status";

export function DashboardPage() {
  const rc = useRemoteControlContext();
  const running = rc.services.filter((service) => service.status !== "stopped").length;
  const failing = rc.services.filter((service) => service.status === "failed" || service.status === "degraded").length;

  return (
    <PageGrid>
      <PageColumn
        title="Services"
        counters={
          <>
            <Counter tone="ok">{running} active</Counter>
            <Counter tone="danger">{failing} attention</Counter>
            <Counter>{rc.services.length} defined</Counter>
          </>
        }
      >
        <NoticeList notices={rc.notices.map((notice) => notice.message)} />

        <ServiceList
          services={rc.services}
          canControl={rc.can("services:control")}
          canViewLogs={rc.can("services:logs")}
          onStart={rc.start}
          onStop={rc.stop}
        />
      </PageColumn>

      {rc.can("metrics:view") ? (
        <PageColumn variant="side">
          <MetricsPanel series={rc.series} />
        </PageColumn>
      ) : null}
    </PageGrid>
  );
}
