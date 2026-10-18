import { useRef } from "react";
import { useScrollToEnd } from "../hooks/useScrollToEnd";
import type { LogPage } from "../../../src/types";

interface LogViewerProps {
  log: LogPage | null;
  /** The path to show while the first fetch is still on its way. */
  fallbackPath: string;
  /** Set when the caller fetched with a byte cap, so the truncation gets explained. */
  truncateBytes?: number;
}

/**
 * The log body shared by the service cards and the update panel. It owns where the
 * reader is looking: opening a log lands on its newest line, a refresh leaves the
 * reader where they were, and *jump to end* is the explicit way back.
 */
export function LogViewer({ log, fallbackPath, truncateBytes }: LogViewerProps) {
  const body = useRef<HTMLPreElement>(null);
  const jumpToEnd = useScrollToEnd(body, log !== null);

  const text =
    log === null ? "loading…" : log.error !== null ? log.error : log.lines.join("\n") || "no output yet";

  return (
    <div className="service-log">
      <div className="service-log-path">
        <span className="service-log-path-text">{log?.logPath ?? fallbackPath}</span>
        <button className="btn btn--ghost service-log-jump" type="button" onClick={jumpToEnd} disabled={log === null}>
          jump to end
        </button>
      </div>
      <pre className="service-log-body" ref={body}>
        {text}
      </pre>
      {truncateBytes !== undefined && log?.truncated ? <div className="service-log-note">truncated to the last {truncateBytes} bytes</div> : null}
    </div>
  );
}
