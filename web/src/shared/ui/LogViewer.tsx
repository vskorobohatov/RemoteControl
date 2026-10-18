import { useRef } from "react";
import type { LogPage } from "@server/types";
import { Button } from "./Button";
import { useScrollToEnd } from "../hooks/useScrollToEnd";
import styles from "./LogViewer.module.scss";

interface LogViewerProps {
  log: LogPage | null;
  fallbackPath: string;
  truncateBytes?: number;
}

export function LogViewer({ log, fallbackPath, truncateBytes }: LogViewerProps) {
  const body = useRef<HTMLPreElement>(null);
  const jumpToEnd = useScrollToEnd(body, log !== null);

  const text =
    log === null ? "loading…" : log.error !== null ? log.error : log.lines.join("\n") || "no output yet";

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
      {truncateBytes !== undefined && log?.truncated ? (
        <div className={styles.note}>truncated to the last {truncateBytes} bytes</div>
      ) : null}
    </div>
  );
}
