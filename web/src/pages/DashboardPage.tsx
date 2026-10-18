import { MetricsPanel } from "../components/MetricsPanel";
import { ServiceCard } from "../components/ServiceCard";
import { useRemoteControlContext } from "../context/RemoteControlProvider";

export function DashboardPage() {
  const rc = useRemoteControlContext();
  const running = rc.services.filter((service) => service.status !== "stopped").length;
  const failing = rc.services.filter((service) => service.status === "failed" || service.status === "degraded").length;

  return (
    <main className="grid">
      <section className="column column--services">
        <div className="column-head">
          <h2 className="column-title">Services</h2>
          <div className="counters">
            <span className="counter counter--run">{running} active</span>
            <span className="counter counter--fail">{failing} attention</span>
            <span className="counter">{rc.services.length} defined</span>
          </div>
        </div>

        {rc.notices.length > 0 ? (
          <ul className="notices">
            {rc.notices.map((notice) => (
              <li className="notice" key={notice.id}>
                {notice.message}
              </li>
            ))}
          </ul>
        ) : null}

        {rc.services.length === 0 ? (
          <p className="empty">
            No services defined. Add entries to <code>config/services.yaml</code> on the remote host.
          </p>
        ) : (
          <div className="service-list">
            {rc.services.map((service) => (
              <ServiceCard key={service.id} service={service} onStart={rc.start} onStop={rc.stop} />
            ))}
          </div>
        )}
      </section>

      <aside className="column column--telemetry">
        <MetricsPanel series={rc.series} />
      </aside>
    </main>
  );
}