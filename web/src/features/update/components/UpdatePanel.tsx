import type { UpdatePhase } from "@server/types";
import { Actions } from "@shared/ui/Actions";
import { Button } from "@shared/ui/Button";
import { Facts } from "@shared/ui/Facts";
import { LogViewer } from "@shared/ui/LogViewer";
import { Message } from "@shared/ui/Message";
import { Panel, PanelHeader } from "@shared/ui/Panel";
import { StatusPill } from "@shared/ui/Status";
import { classnames, type Tone } from "@shared/ui/controls";
import { useLogFeed } from "@shared/hooks/useLogFeed";
import { formatClock } from "@shared/lib/format";
import { fetchUpdateLog } from "../api";
import type { UpdateController } from "../hooks/useUpdate";
import styles from "./UpdatePanel.module.scss";

const LOG_BYTES = 32_768;
const LOG_PATH = "logs/update.log";

const PHASE_LABEL: Record<UpdatePhase, string> = {
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

const PHASE_TONE: Record<UpdatePhase, Tone | null> = {
  unknown: null,
  unavailable: null,
  checking: "external",
  "up-to-date": "ok",
  available: "warn",
  blocked: "warn",
  applying: "external",
  restarting: "external",
  failed: "danger",
};

/**
 * The readout half of the self-update panel: what the checkout is, what the remote
 * offers and what the last run did - and the log that explains that run, opened at the
 * bottom of the panel because the steps above are what it decodes. The buttons that
 * change anything live in `UpdateActions`, on the other side of the Settings page.
 */
export function UpdatePanel({ update }: { update: UpdateController }) {
  const { status, error } = update;
  const phase: UpdatePhase = status?.phase ?? "unknown";
  const tone = PHASE_TONE[phase];
  const target = status?.target ?? null;
  const run = status?.lastRun ?? null;
  const log = useLogFeed({ fetch: () => fetchUpdateLog(LOG_BYTES), id: "update", logPath: LOG_PATH });

  return (
    <Panel>
      <PanelHeader title="Self-update" meta={<StatusPill tone={tone ?? undefined}>{PHASE_LABEL[phase]}</StatusPill>} />

      <div className={styles.versions}>
        <span className={styles.current}>v{status?.currentVersion ?? "—"}</span>
        {target !== null ? (
          <>
            <span className={styles.arrow} aria-hidden="true">
              →
            </span>
            <span className={styles.target}>v{target.version}</span>
            <code className={styles.branch}>{target.branch}</code>
          </>
        ) : null}
      </div>

      <Facts
        items={[
          { label: "remote", value: status?.remote ?? "—" },
          { label: "branch", value: status?.branch ?? "detached HEAD" },
          { label: "working tree", value: status?.dirty ? "uncommitted changes" : "clean" },
          { label: "last check", value: formatClock(status?.checkedAt ?? null) },
        ]}
      />

      {status !== null && status.releases.length > 0 ? (
        <div className={styles.releases}>
          {status.releases.map((release) => (
            <span
              key={release.branch}
              className={classnames(styles.release, target?.branch === release.branch && styles.releaseTarget)}
            >
              v{release.version}
            </span>
          ))}
        </div>
      ) : null}

      {status?.message ? <Message>{status.message}</Message> : null}
      {error !== null ? <Message tone="danger">{error}</Message> : null}

      {status !== null && status.incomingCommits.length > 0 ? (
        <ul className={styles.commits}>
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
        <ol className={styles.steps}>
          {run.steps.map((step, index) => (
            <li
              key={`${step.at}-${index}`}
              className={classnames(styles.step, step.ok ? styles.stepOk : styles.stepFail)}
              title={step.detail}
            >
              <span>{step.label}</span>
              <span className={styles.stepTime}>{formatClock(step.at)}</span>
            </li>
          ))}
        </ol>
      ) : null}

      <Actions>
        <Button variant="secondary" onClick={log.toggle}>
          {log.open ? "hide log" : "view log"}
        </Button>
        {log.open ? (
          <Button variant="secondary" disabled={log.pending} onClick={log.refresh}>
            refresh
          </Button>
        ) : null}
      </Actions>

      {log.open ? <LogViewer log={log.log} fallbackPath={LOG_PATH} truncateBytes={LOG_BYTES} /> : null}
    </Panel>
  );
}
