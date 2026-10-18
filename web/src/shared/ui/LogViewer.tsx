import { useRef } from "react";
import type { LogPage } from "@server/types";
import { Button } from "./Button";
import { classnames } from "./controls";
import { useScrollToEnd } from "../hooks/useScrollToEnd";
import styles from "./LogViewer.module.scss";

interface LogViewerProps {
  log: LogPage | null;
  fallbackPath: string;
  truncateBytes?: number;
}

export function LogViewer({ log, fallbackPath, truncateBytes }: LogViewerProps) {
  const body = useRef<HTMLPreElement>(null);
  const error = log?.error ?? null;
  const lines = log?.lines ?? [];
  /* The log object is the key: it changes with every read, and the viewer follows the
     tail unless the reader has scrolled away from it. */
  const jumpToEnd = useScrollToEnd(body, log !== null, log);

  const text = log === null ? "loading…" : lines.join("\n") || (error !== null ? error : "no output yet");

  return (
    <div className={styles.log}>
      <div className={styles.path}>
        <span className={styles.pathText}>{log?.logPath ?? fallbackPath}</span>
        <Button variant="secondary" size="sm" className={styles.jump} onClick={jumpToEnd} disabled={log === null}>
          jump to end
        </Button>
      </div>
      <pre className={styles.body} ref={body}>
        {text}
      </pre>
      {error !== null && lines.length > 0 ? (
        <div className={classnames(styles.note, styles.noteError)}>{error}</div>
      ) : null}
      {truncateBytes !== undefined && log?.truncated ? (
        <div className={styles.note}>truncated to the last {truncateBytes} bytes</div>
      ) : null}
    </div>
  );
}
