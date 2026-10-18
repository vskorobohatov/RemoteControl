import { useCallback, useState } from "react";
import { fetchUpdateLog } from "../api";
import type { UpdateController } from "../hooks/useUpdate";
import { formatClock } from "../format";
import type { LogPage } from "../../../src/types";

const LOG_BYTES = 32_768;

const PHASE_LABEL: Record<string, string> = {
  unknown: "not checked",
  unavailable: "unavailable",
  checking: "checking…",
  "up-to-date": "up to date",
  available: "update available",
  blocked: "update blocked",
  applying: "applying…",
  restarting: "restarting…",
  failed: "failed",
};

const PHASE_TONE: Record<string, "idle" | "active" | "ok" | "warn" | "bad"> = {
  unknown: "idle",
  unavailable: "idle",
  checking: "active",
  "up-to-date": "ok",
  available: "warn",
  blocked: "warn",
  applying: "active",
  restarting: "active",
  failed: "bad",
};

export function UpdatePanel({ update, canApply }: { update: UpdateController; canApply: boolean }) {
  const { status, error, busy, check, apply } = update;
  const [log, setLog] = useState<LogPage | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const loadLog = useCallback(async () => {
    setPending(true);
    try {
      setLog(await fetchUpdateLog(LOG_BYTES));
    } catch (caught) {
      setLog({
        id: "update",
        logPath: "logs/update.log",
        lines: [],
        truncated: false,
        error: caught instanceof Error ? caught.message : String(caught),
      });
    } finally {
      setPending(false);
    }
  }, []);

  const toggleLog = useCallback(() => {
    const next = !logOpen;
    setLogOpen(next);
    if (next && log === null) {
      void loadLog();
    }
  }, [log, logOpen, loadLog]);

  const phase = status?.phase ?? "unknown";
  const tone = PHASE_TONE[phase] ?? "idle";
  const target = status?.target ?? null;
  const run = status?.lastRun ?? null;

  return (
    <section className="panel panel--update">
      <header className="panel-head">
        <h2 className="panel-title">Self-update</h2>
        <span className={`pill pill--update pill--update-${tone}`}>{PHASE_LABEL[phase] ?? phase}</span>
      </header>

      <div className="update-versions">
        <span className="update-current">v{status?.currentVersion ?? "—"}</span>
        {target !== null ? (
          <>
            <span className="update-arrow" aria-hidden="true">
              →
            </span>
            <span className="update-target">v{target.version}</span>
            <code className="update-branch">{target.branch}</code>
          </>
        ) : null}
      </div>

      <dl className="facts">
        <div>
          <dt>remote</dt>
          <dd>{status?.remote ?? "—"}</dd>
        </div>
        <div>
          <dt>branch</dt>
          <dd>{status?.branch ?? "detached HEAD"}</dd>
        </div>
        <div>
          <dt>working tree</dt>
          <dd>{status?.dirty ? "uncommitted changes" : "clean"}</dd>
        </div>
        <div>
          <dt>last check</dt>
          <dd>{formatClock(status?.checkedAt ?? null)}</dd>
        </div>
      </dl>

      {status !== null && status.releases.length > 0 ? (
        <div className="update-releases">
          {status.releases.map((release) => (
            <span
              className={`release${target?.branch === release.branch ? " release--target" : ""}`}
              key={release.branch}
            >
              v{release.version}
            </span>
          ))}
        </div>
      ) : null}

      {status?.message ? <p className="update-message">{status.message}</p> : null}
      {error !== null ? <p className="update-message update-message--error">{error}</p> : null}

      {status !== null && status.incomingCommits.length > 0 ? (
        <ul className="update-commits">
          {status.incomingCommits.map((commit) => (
            <li key={commit.shortHash}>
              <code>{commit.shortHash}</code>
              <span>{commit.subject}</span>
              <em>{commit.author}</em>
            </li>
          ))}
        </ul>
      ) : null}

      {run !== null && run.steps.length > 0 ? (
        <ol className="update-steps">
          {run.steps.map((step, index) => (
            <li
              className={`update-step update-step--${step.ok ? "ok" : "fail"}`}
              key={`${step.at}-${index}`}
              title={step.detail}
            >
              <span className="update-step-label">{step.label}</span>
              <span className="update-step-time">{formatClock(step.at)}</span>
            </li>
          ))}
        </ol>
      ) : null}

      <p className="update-note">
        “Update now” checks out the newest release branch, pulls it, rebuilds and restarts the server. This page
        reloads itself once the new version answers.
      </p>

      <footer className="service-actions">
        <button className="btn btn--ghost" type="button" disabled={busy} onClick={() => void check()}>
          Check for updates
        </button>
        <button
          className="btn btn--start"
          type="button"
          disabled={busy || !canApply || !status?.canApply}
          title={canApply ? undefined : "only an admin may apply an update"}
          onClick={() => void apply()}
        >
          Update now
        </button>
        <button className="btn btn--ghost" type="button" onClick={toggleLog}>
          {logOpen ? "hide log" : "view log"}
        </button>
        {logOpen ? (
          <button className="btn btn--ghost" type="button" disabled={pending} onClick={() => void loadLog()}>
            refresh
          </button>
        ) : null}
      </footer>

      {logOpen ? (
        <div className="service-log">
          <div className="service-log-path">{log?.logPath ?? "logs/update.log"}</div>
          <pre className="service-log-body">
            {log === null ? "loading…" : log.error !== null ? log.error : log.lines.join("\n") || "no output yet"}
          </pre>
        </div>
      ) : null}
    </section>
  );
}