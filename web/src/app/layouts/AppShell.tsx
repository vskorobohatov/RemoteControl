import { useState } from "react";
import { NavLink, Outlet } from "react-router";
import type { Permission } from "@server/types";
import { Button } from "@shared/ui/Button";
import { classnames } from "@shared/ui/controls";
import { CloseIcon, MenuIcon } from "@shared/ui/icons";
import { formatClock } from "@shared/lib/format";
import { RoleTag } from "@features/auth/components/RoleTag";
import { useRemoteControlContext } from "../providers/RemoteControlContext";
import styles from "./AppShell.module.scss";

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

const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", permission: "services:view", end: true },
  { to: "/monitor", label: "Monitor", permission: "metrics:view" },
  { to: "/settings", label: "Settings", permission: "update:view" },
  { to: "/users", label: "Accounts", permission: "users:manage" },
];

export function AppShell() {
  const rc = useRemoteControlContext();
  const system = rc.system;
  const account = rc.session?.user ?? null;
  const lastSample = rc.series.at(-1);
  const [menuOpen, setMenuOpen] = useState(false);
  const items = NAV.filter((item) => rc.can(item.permission));

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">
            RC
          </span>
          <div className={styles.brandText}>
            <span className={styles.brandName}>RemoteControl</span>
            <span className={styles.brandSub}>service console</span>
          </div>
        </div>

        <nav className={styles.nav}>
          {items.map((item) => (
            <NavLink
              key={item.to}
              className={({ isActive }) => classnames(styles.navLink, isActive && styles.navActive)}
              to={item.to}
              end={item.end}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className={styles.topbarRight}>
          <span className={classnames(styles.link, styles["link-" + rc.status])}>
            <span className={styles.dot} />
            <span className={styles.linkLabel}>{STATUS_LABEL[rc.status] ?? rc.status}</span>
          </span>
          {account !== null ? (
            <span className={styles.account} title={"signed in as " + account.login}>
              <span className={styles.accountLogin}>{account.login}</span>
              <RoleTag role={account.role} />
            </span>
          ) : null}
          <Button className={styles.signOutDesktop} onClick={() => void rc.signOut()}>
            sign out
          </Button>
          <Button
            variant="icon"
            className={styles.menuToggle}
            aria-expanded={menuOpen}
            aria-label="menu"
            glyph={menuOpen ? <CloseIcon /> : <MenuIcon />}
            onClick={() => setMenuOpen((open) => !open)}
          />
        </div>
      </header>

      <div className={classnames(styles.mobileMenu, menuOpen && styles.menuOpen)}>
        <nav className={styles.mobileNav}>
          {items.map((item) => (
            <NavLink
              key={item.to}
              className={({ isActive }) => classnames(styles.navLink, isActive && styles.navActive)}
              to={item.to}
              end={item.end}
              onClick={() => setMenuOpen(false)}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        {account !== null ? (
          <span className={styles.account} title={"signed in as " + account.login}>
            <span className={styles.accountLogin}>{account.login}</span>
            <RoleTag role={account.role} />
          </span>
        ) : null}
        <Button
          className={styles.signOut}
          onClick={() => {
            setMenuOpen(false);
            void rc.signOut();
          }}
        >
          sign out
        </Button>
      </div>

      {rc.error !== null ? (
        <div className={styles.banner}>
          <span>{rc.error}</span>
          <Button onClick={rc.reconnect}>retry</Button>
        </div>
      ) : null}

      <Outlet />

      <footer className={styles.statusbar}>
        <span>
          {system?.server.publicUrl ?? "—"} · v{system?.appVersion ?? "—"}
        </span>
        <span>
          {rc.series.length} samples · last {formatClock(lastSample?.t ?? null)} · interval{" "}
          {rc.sampleIntervalMs === null ? "—" : Math.round(rc.sampleIntervalMs) + "ms"}
        </span>
      </footer>
    </div>
  );
}
