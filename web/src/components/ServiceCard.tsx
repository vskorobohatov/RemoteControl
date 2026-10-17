import { useCallback, useState } from "react";
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
