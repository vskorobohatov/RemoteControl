import { NavLink, Outlet } from "react-router";
import { formatClock } from "../format";
import { useRemoteControlContext } from "../context/RemoteControlProvider";
import type { Permission } from "../../../src/types";

const STATUS_LABEL: Record<string, string> = {
  live: "streaming",
  connecting: "connecting",
  reconnecting: "reconnecting",
  offline: "offline",
  "needs-account": "signed out",
};

interface NavItem {
  to: string;
  label: string;
  permission: Permission;
  end?: boolean;
}

/* The nav is built from the permissions the server handed out, so a link that would
   only lead to a 403 is never drawn. */
const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", permission: "services:view", end: true },
  { to: "/settings", label: "Settings", permission: "update:view" },
  { to: "/users", label: "Accounts", permission: "users:manage" },
];

export function AppShell() {
  const rc = useRemoteControlContext();
  const system = rc.system;
  const account = rc.session?.user ?? null;
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
          {NAV.filter((item) => rc.can(item.permission)).map((item) => (
            <NavLink
              key={item.to}
              className={({ isActive }) => `nav-link${isActive ? " nav-link--active" : ""}`}
              to={item.to}
              end={item.end}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="topbar-right">
          <span className={`link link--${rc.status}`}>
            <span className="link-dot" />
            {STATUS_LABEL[rc.status] ?? rc.status}
          </span>
          {account !== null ? (
            <span className="account" title={`signed in as ${account.login}`}>
              <span className="account-login">{account.login}</span>
              <span className={`role role--${account.role}`}>{account.role}</span>
            </span>
          ) : null}
          <button className="btn btn--ghost" type="button" onClick={rc.reconnect}>
            reload
          </button>
          <button className="btn btn--ghost" type="button" onClick={() => void rc.signOut()}>
            sign out
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