import { useCallback, useState } from "react";
import { fetchUpdateLog } from "../api";
import { LogViewer } from "./LogViewer";
import type { UpdateController } from "../hooks/useUpdate";
import type { LogPage } from "../../../src/types";

const LOG_BYTES = 32_768;

/**
 * The controls half of the self-update, placed under the runtime facts so the readout
 * on the left stays a readout. The log viewer belongs here rather than next to the
 * status it describes, because its toggle button is here.
 */
export function UpdateActions({ update, canApply }: { update: UpdateController; canApply: boolean }) {
  const { status, busy, checkBusy, check, apply, reset } = update;
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

  const run = status?.lastRun ?? null;
  /* A finished run is a record, not live work: offer the manual way back in case
     the automatic one did not apply. */
  const canReset = run !== null && run.status !== "running";

  return (
    <section className="panel panel--update-actions">
      <header className="panel-head">
        <h2 className="panel-title">Update actions</h2>
        <span className="panel-clock">{busy ? "working…" : "idle"}</span>
      </header>

      <p className="update-note">
        “Update now” checks out the newest release branch, pulls it, rebuilds and restarts the server. This page
        reloads itself once the new version answers.
      </p>

      <footer className="service-actions">
        <button className="btn btn--ghost" type="button" disabled={checkBusy} onClick={() => void check()}>
          Check for updates
        </button>
        {canReset && canApply ? (
          <button className="btn btn--ghost" type="button" disabled={busy} onClick={() => void reset()}>
            reset panel
          </button>
        ) : null}
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

      {logOpen ? <LogViewer log={log} fallbackPath="logs/update.log" truncateBytes={LOG_BYTES} /> : null}
    </section>
  );
}