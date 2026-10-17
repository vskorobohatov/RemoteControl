import { MetricsPanel } from "./components/MetricsPanel";
import { ServiceCard } from "./components/ServiceCard";
import { TokenGate } from "./components/TokenGate";
import { formatClock, formatUptime } from "./format";
import { useRemoteControl } from "./useRemoteControl";

const STATUS_LABEL: Record<string, string> = {
  live: "streaming",
  connecting: "connecting",
  reconnecting: "reconnecting",
  offline: "offline",
  "needs-token": "token required",
};

export function App() {
  const rc = useRemoteControl();

  if (rc.status === "needs-token") {
    return <TokenGate onSubmit={rc.provideToken} />;
  }

  const system = rc.system;
  const running = rc.services.filter((service) => service.status !== "stopped").length;
  const failing = rc.services.filter((service) => service.status === "failed" || service.status === "degraded").length;
  const lastSample = rc.series.at(-1);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            RC
          </span>
          <div className="brand-text">
            <span className="brand-name">RemoteControl</span>
            <span className="brand-sub">service console</span>
          </div>
        </div>

        <div className="hostline">
          <span className="chip chip--host">{system?.hostname ?? "—"}</span>
          <span className="chip">{system ? `${system.arch} · ${system.kernel}` : "—"}</span>
          <span className="chip">up {formatUptime(system?.uptimeSeconds ?? null)}</span>
          <span className="chip">{system ? `${system.logicalCores} cores` : "—"}</span>
        </div>

        <div className="topbar-right">
          <span className={`link link--${rc.status}`}>
            <span className="link-dot" />
            {STATUS_LABEL[rc.status] ?? rc.status}
          </span>
          <button className="btn btn--ghost" type="button" onClick={rc.reconnect}>
            reload
          </button>
          <button className="btn btn--ghost" type="button" onClick={rc.forgetToken}>
            disconnect
          </button>
        </div>
      </header>

      {rc.error !== null ? (
        <div className="banner banner--error">
          <span>{rc.error}</span>
          <button className="btn btn--ghost" type="button" onClick={rc.reconnect}>
            retry
          </button>
        </div>
      ) : null}

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

      <footer className="statusbar">
        <span>
          {system?.server.configPath ?? "—"} · v{system?.appVersion ?? "—"} · {system?.server.publicUrl ?? "—"}
        </span>
        <span>
          {rc.series.length} samples · last {formatClock(lastSample?.t ?? null)} · interval{" "}
          {rc.sampleIntervalMs === null ? "—" : `${Math.round(rc.sampleIntervalMs)}ms`}
        </span>
      </footer>
    </div>
  );
}
