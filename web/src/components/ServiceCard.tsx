import { useCallback, useEffect, useRef, useState } from "react";
import { fetchLog } from "../api";
import { formatClock, formatUptime } from "../format";
import type { LogPage, ServiceState } from "../../../src/types";

const LOG_BYTES = 65_536;

interface ServiceCardProps {
  service: ServiceState;
  onStart: (id: string) => Promise<void>;
  onStop: (id: string) => Promise<void>;
}

export function ServiceCard({ service, onStart, onStop }: ServiceCardProps) {
  const [log, setLog] = useState<LogPage | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (copyTimer.current !== null) {
        window.clearTimeout(copyTimer.current);
      }
    },
    [],
  );

  const loadLog = useCallback(async () => {
    setPending(true);
    try {
      setLog(await fetchLog(service.id, LOG_BYTES));
    } catch (error) {
      setLog({ id: service.id, logPath: service.logPath, lines: [], truncated: false, error: String(error) });
    } finally {
      setPending(false);
    }
  }, [service.id, service.logPath]);

  const toggleLog = useCallback(() => {
    const next = !logOpen;
    setLogOpen(next);
    if (next && log === null) {
      void loadLog();
    }
  }, [log, logOpen, loadLog]);

  const copyLink = useCallback(async () => {
    if (service.link === null) {
      return;
    }
    setCopied(await copyToClipboard(service.link));
    if (copyTimer.current !== null) {
      window.clearTimeout(copyTimer.current);
    }
    copyTimer.current = window.setTimeout(() => setCopied(false), 1600);
  }, [service.link]);

  const transitional = service.status === "starting" || service.status === "stopping";
  const running = service.status !== "stopped";

  return (
    <article className={`service service--${service.status}`}>
      <header className="service-head">
        <div className="service-id">
          <span className={`service-dot service-dot--${service.status}`} />
          <h3 className="service-name">{service.name}</h3>
          <code className="service-key">{service.id}</code>
        </div>
        <span className={`pill pill--${service.status}`}>{service.status}</span>
      </header>

      {service.description.length > 0 ? <p className="service-desc">{service.description}</p> : null}

      {service.link !== null ? (
        <div className="service-link">
          <a
            className="service-link-url"
            href={service.link}
            target="_blank"
            rel="noreferrer noopener"
            title="open in a new tab"
          >
            {service.link}
          </a>
          <button
            className={`btn btn--icon${copied ? " btn--icon--copied" : ""}`}
            type="button"
            onClick={() => void copyLink()}
            aria-label={copied ? "link copied" : "copy service link"}
            title={copied ? "link copied" : "copy service link"}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
        </div>
      ) : null}

      <dl className="service-facts">
        <div>
          <dt>unit</dt>
          <dd>
            {service.unit}
            {service.managedBy === "external" ? <span className="tag tag--external">external</span> : null}
          </dd>
        </div>
        <div>
          <dt>pid</dt>
          <dd>{service.pid ?? "—"}</dd>
        </div>
        <div>
          <dt>uptime</dt>
          <dd>{formatUptime(service.uptimeSeconds)}</dd>
        </div>
        <div>
          <dt>last exit</dt>
          <dd>{service.lastExitCode === null ? "—" : `code ${service.lastExitCode}`}</dd>
        </div>
        <div>
          <dt>health</dt>
          <dd>
            {service.health === null
              ? "not configured"
              : `${service.health.ok ? "ok" : "failing"} ${service.health.statusCode ?? ""} ${formatClock(service.health.checkedAt)}`}
          </dd>
        </div>
      </dl>

      {service.lastError !== null ? <p className="service-error">{service.lastError}</p> : null}

      <footer className="service-actions">
        <button
          className="btn btn--start"
          type="button"
          disabled={transitional || service.status === "ready" || service.status === "running"}
          onClick={() => onStart(service.id)}
        >
          Start
        </button>
        <button className="btn btn--stop" type="button" disabled={transitional || !running} onClick={() => onStop(service.id)}>
          Stop
        </button>
        <button className="btn btn--ghost" type="button" onClick={toggleLog}>
          {logOpen ? "hide log" : "view log"}
        </button>
        {logOpen ? (
          <button className="btn btn--ghost" type="button" disabled={pending} onClick={loadLog}>
            refresh
          </button>
        ) : null}
      </footer>

      {logOpen ? (
        <div className="service-log">
          <div className="service-log-path">{log?.logPath ?? service.logPath}</div>
          <pre className="service-log-body">
            {log === null ? "loading…" : log.error !== null ? log.error : log.lines.join("\n") || "no output yet"}
          </pre>
          {log?.truncated ? <div className="service-log-note">truncated to the last {LOG_BYTES} bytes</div> : null}
        </div>
      ) : null}
    </article>
  );
}

/**
 * `navigator.clipboard` only exists in secure contexts, and the dashboard is usually served over plain http on
 * the LAN, so keep the deprecated-but-universal textarea path as the fallback.
 */
async function copyToClipboard(value: string): Promise<boolean> {
  const clipboard = globalThis.navigator?.clipboard as Clipboard | undefined;
  if (clipboard !== undefined) {
    try {
      await clipboard.writeText(value);
      return true;
    } catch {
      /* denied permission or an insecure context: fall through */
    }
  }
  return legacyCopy(value);
}

function legacyCopy(value: string): boolean {
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "-1000px";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();

  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(area);
  return ok;
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
      <rect x="6" y="6" width="8" height="8.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M10.5 4.5H4A1.5 1.5 0 0 0 2.5 6v6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
      <path
        d="M3 8.5l3.5 3.5L13 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
