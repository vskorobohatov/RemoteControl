import { NavLink, Outlet } from "react-router";
import { formatClock } from "../format";
import { useRemoteControlContext } from "../context/RemoteControlProvider";

const STATUS_LABEL: Record<string, string> = {
  live: "streaming",
  connecting: "connecting",
  reconnecting: "reconnecting",
  offline: "offline",
  "needs-token": "token required",
};

export function AppShell() {
  const rc = useRemoteControlContext();
  const system = rc.system;
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

        <nav className="nav">
          <NavLink className={({ isActive }) => `nav-link${isActive ? " nav-link--active" : ""}`} to="/" end>
            Dashboard
          </NavLink>
          <NavLink className={({ isActive }) => `nav-link${isActive ? " nav-link--active" : ""}`} to="/settings">
            Settings
          </NavLink>
        </nav>

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

      <Outlet />

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