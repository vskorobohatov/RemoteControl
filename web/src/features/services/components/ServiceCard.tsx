import { useCallback, useEffect, useRef, useState } from "react";
import type { ServiceState } from "@server/types";
import { Actions } from "@shared/ui/Actions";
import { Button } from "@shared/ui/Button";
import { Card } from "@shared/ui/Card";
import { classnames } from "@shared/ui/controls";
import { Facts } from "@shared/ui/Facts";
import { LogViewer } from "@shared/ui/LogViewer";
import { Message } from "@shared/ui/Message";
import { StatusPill, Tag } from "@shared/ui/Status";
import { CheckIcon, CopyIcon } from "@shared/ui/icons";
import { useLogFeed } from "@shared/hooks/useLogFeed";
import { copyToClipboard } from "@shared/lib/clipboard";
import { formatClock, formatUptime } from "@shared/lib/format";
import { fetchLog } from "../api";
import { STATUS_TONE, TRANSITIONAL } from "../status";
import styles from "./ServiceCard.module.scss";

const LOG_BYTES = 65_536;

interface ServiceCardProps {
  service: ServiceState;
  canControl: boolean;
  canViewLogs: boolean;
  onStart: (id: string) => Promise<void>;
  onStop: (id: string) => Promise<void>;
}

export function ServiceCard({ service, canControl, canViewLogs, onStart, onStop }: ServiceCardProps) {
  const log = useLogFeed({
    fetch: () => fetchLog(service.id, LOG_BYTES),
    id: service.id,
    logPath: service.logPath,
  });
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

  const tone = STATUS_TONE[service.status];
  const transitional = TRANSITIONAL.has(service.status);
  const running = service.status !== "stopped";
  const startDisabled = transitional || service.status === "ready" || service.status === "running";

  return (
    <Card accent={tone ?? undefined}>
      <header className={styles.head}>
        <div className={styles.identity}>
          <span
            className={classnames(
              styles.dot,
              tone !== null && styles[`dot-${tone}`],
              transitional && styles.dotBlink,
            )}
            aria-hidden="true"
          />
          <h3 className={styles.name}>{service.name}</h3>
          <code className={styles.key}>{service.id}</code>
        </div>
        <StatusPill tone={tone ?? undefined} className={styles.pill}>
          {service.status}
        </StatusPill>
      </header>

      {service.description.length > 0 ? <p className={styles.description}>{service.description}</p> : null}

      {service.link !== null ? (
        <div className={styles.link}>
          <a
            className={styles.linkUrl}
            href={service.link}
            target="_blank"
            rel="noreferrer noopener"
            title="open in a new tab"
          >
            {service.link}
          </a>
          <Button
            variant="icon"
            size="sm"
            active={copied}
            glyph={copied ? <CheckIcon /> : <CopyIcon />}
            onClick={() => void copyLink()}
            aria-label={copied ? "link copied" : "copy service link"}
            title={copied ? "link copied" : "copy service link"}
          />
        </div>
      ) : null}

      <Facts
        items={[
          {
            label: "unit",
            value: (
              <>
                {service.unit}
                {service.managedBy === "external" ? <Tag tone="external">external</Tag> : null}
              </>
            ),
          },
          { label: "pid", value: service.pid ?? "—" },
          { label: "uptime", value: formatUptime(service.uptimeSeconds) },
          { label: "last exit", value: service.lastExitCode === null ? "—" : `code ${service.lastExitCode}` },
          {
            label: "health",
            value: service.health === null
              ? "not configured"
              : `${service.health.ok ? "ok" : "failing"} ${service.health.statusCode ?? ""} ${formatClock(service.health.checkedAt)}`,
          },
        ]}
      />

      {service.lastError !== null ? <Message tone="danger">{service.lastError}</Message> : null}

      <Actions>
        {canControl ? (
          <>
            <Button variant="success" disabled={startDisabled} onClick={() => void onStart(service.id)}>
              Start
            </Button>
            <Button variant="danger" disabled={transitional || !running} onClick={() => void onStop(service.id)}>
              Stop
            </Button>
          </>
        ) : null}
        {canViewLogs ? (
          <>
            <Button variant="secondary" onClick={log.toggle}>
              {log.open ? "hide log" : "view log"}
            </Button>
            {log.open ? (
              <Button variant="secondary" disabled={log.pending} onClick={log.refresh}>
                refresh
              </Button>
            ) : null}
          </>
        ) : null}
      </Actions>

      {log.open ? <LogViewer log={log.log} fallbackPath={service.logPath} truncateBytes={LOG_BYTES} /> : null}
    </Card>
  );
}
