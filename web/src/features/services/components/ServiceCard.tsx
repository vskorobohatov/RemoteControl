import { useState } from "react";
import type { ServiceState } from "@server/types";
import { Actions } from "@shared/ui/Actions";
import { Button } from "@shared/ui/Button";
import { Card } from "@shared/ui/Card";
import { classnames } from "@shared/ui/controls";
import { LogViewer } from "@shared/ui/LogViewer";
import { Message } from "@shared/ui/Message";
import { Select } from "@shared/ui/Select";
import { StatusPill } from "@shared/ui/Status";
import { CheckIcon, CopyIcon } from "@shared/ui/icons";
import { PasswordInput } from "@shared/ui/TextInput";
import { useCopyFlash } from "@shared/hooks/useCopyFlash";
import { useLogFeed } from "@shared/hooks/useLogFeed";
import { fetchLog } from "../api";
import { STATUS_TONE, TRANSITIONAL } from "../status";
import styles from "./ServiceCard.module.scss";

const LOG_BYTES = 65_536;

interface ServiceCardProps {
  service: ServiceState;
  storedKey: string | null;
  canControl: boolean;
  canViewLogs: boolean;
  onStart: (id: string, model: string | null, apiKey: string | null) => Promise<void>;
  onStop: (id: string) => Promise<void>;
}

export function ServiceCard({ service, storedKey, canControl, canViewLogs, onStart, onStop }: ServiceCardProps) {
  const log = useLogFeed({
    fetch: () => fetchLog(service.id, LOG_BYTES),
    id: service.id,
    logPath: service.logPath,
  });
  const linkCopy = useCopyFlash();
  const modelCopy = useCopyFlash();
  const keyCopy = useCopyFlash();

  const tone = STATUS_TONE[service.status];
  const transitional = TRANSITIONAL.has(service.status);
  const running = service.status !== "stopped";
  const startDisabled = transitional || service.status === "ready" || service.status === "running";
  const linkUrl = service.link;
  const hasModel = service.modelOptions.length > 0;
  const [modelChoice, setModelChoice] = useState(service.modelDefault ?? "");
  const modelName = service.model ?? modelChoice;
  const keyEnv = service.apiKeyEnv;
  const takesKey = keyEnv !== null;
  /* Nothing typed yet means the key this service was last started with, which the
     provider fetched beside the service list; a typed value takes over from then on. */
  const [typedKey, setTypedKey] = useState<string | null>(null);
  const apiKey = typedKey ?? storedKey ?? "";
  /* A key belongs to a start, so the field is editable exactly while Start is offered. */
  const keyDisabled = takesKey && startDisabled;
  /* The selector belongs to a start the same way: a running service already picked one. */
  const offerSelector = hasModel && !startDisabled;
  const keyHint = keyDisabled
    ? "stop the service to change the key"
    : apiKey.length > 0
      ? "the key of the last start · typing replaces it"
      : "empty reuses the key of the last start";

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

      {linkUrl !== null ? (
        <div className={styles.link}>
          <a
            className={styles.linkUrl}
            href={linkUrl}
            target="_blank"
            rel="noreferrer noopener"
            title="open in a new tab"
          >
            {linkUrl}
          </a>
          <Button
            variant="icon"
            size="sm"
            active={linkCopy.copied}
            glyph={linkCopy.copied ? <CheckIcon /> : <CopyIcon />}
            onClick={() => void linkCopy.copy(linkUrl)}
            aria-label={linkCopy.copied ? "link copied" : "copy service link"}
            title={linkCopy.copied ? "link copied" : "copy service link"}
          />
        </div>
      ) : null}

      {service.lastError !== null ? <Message tone="danger">{service.lastError}</Message> : null}

      {hasModel ? (
        <div className={styles.modelZone}>
          <code className={styles.modelValue}>{modelName}</code>
          <Button
            variant="icon"
            size="sm"
            active={modelCopy.copied}
            glyph={modelCopy.copied ? <CheckIcon /> : <CopyIcon />}
            onClick={() => void modelCopy.copy(modelName)}
            aria-label={modelCopy.copied ? "model copied" : "copy model name"}
            title={modelCopy.copied ? "model copied" : "copy model name"}
          />
        </div>
      ) : null}

      {offerSelector ? (
        <Select
          className={styles.modelSelect}
          size="sm"
          label="model"
          options={service.modelOptions}
          value={modelChoice}
          onChange={(value) => setModelChoice(value)}
        />
      ) : null}

      {takesKey ? (
        <div className={styles.keyZone}>
          <PasswordInput
            className={styles.apiKey}
            size="sm"
            label={`api key · ${keyEnv ?? ""}`}
            hint={keyHint}
            disabled={keyDisabled}
            value={apiKey}
            autoComplete="off"
            onChange={(event) => setTypedKey(event.target.value)}
          />
          {apiKey.length > 0 ? (
            <Button
              variant="icon"
              size="sm"
              active={keyCopy.copied}
              glyph={keyCopy.copied ? <CheckIcon /> : <CopyIcon />}
              onClick={() => void keyCopy.copy(apiKey)}
              aria-label={keyCopy.copied ? "api key copied" : "copy api key"}
              title={keyCopy.copied ? "api key copied" : "copy api key"}
            />
          ) : null}
        </div>
      ) : null}

      <Actions>
        {canControl ? (
          <>
            <Button
              variant="success"
              disabled={startDisabled}
              onClick={() =>
                void onStart(
                  service.id,
                  hasModel && modelChoice.length > 0 ? modelChoice : null,
                  takesKey && apiKey.length > 0 ? apiKey : null,
                )
              }
            >
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
          </>
        ) : null}
      </Actions>

      {log.open ? <LogViewer log={log.log} fallbackPath={service.logPath} truncateBytes={LOG_BYTES} /> : null}
    </Card>
  );
}
