import { formatClock } from "../format";
import type { UpdateController } from "../hooks/useUpdate";

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

/**
 * The read-only half of the self-update panel: what the checkout is, what the remote
 * offers and what the last run did. The controls live in `UpdateActions`, which sits
 * under the runtime facts on the other side of the Settings page.
 */
export function UpdatePanel({ update }: { update: UpdateController }) {
  const { status, error } = update;
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
    </section>
  );
}