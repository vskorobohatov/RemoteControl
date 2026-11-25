import { useState } from "react";
import type { SystemResponse } from "@features/system/api";
import { formatUptime } from "@shared/lib/format";
import { Actions } from "@shared/ui/Actions";
import { Button } from "@shared/ui/Button";
import { Message } from "@shared/ui/Message";
import { Panel, PanelHeader } from "@shared/ui/Panel";
import { useHostControls, type PowerAction } from "../hooks/useHostControls";
import styles from "./ControlsPanel.module.scss";

interface ControlsPanelProps {
  system: SystemResponse | null;
}

const LABELS: Record<PowerAction, string> = { restart: "Restart", shutdown: "Shutdown" };

export function ControlsPanel({ system }: ControlsPanelProps) {
  const host = useHostControls();
  /* Nothing here is undoable from a browser, so the first press only arms the second one. */
  const [confirming, setConfirming] = useState<PowerAction | null>(null);

  const status = host.status;
  const meta = system === null ? undefined : `${system.hostname} · up ${formatUptime(system.uptimeSeconds)}`;

  return (
    <Panel>
      <PanelHeader title="Controls" meta={meta} />

      <p className={styles.note}>
        These act on the machine this dashboard runs on. Restart reboots it; Shutdown turns it off, and the
        server, every service scope and any loaded model go down with it. Nothing here brings it back.
      </p>

      {status !== null && !status.canShutdown && !status.canRestart ? <Message tone="warn">{status.detail}</Message> : null}
      {host.error !== null ? <Message tone="danger">{host.error}</Message> : null}
      {host.requested !== null ? <Message tone="ok">{host.requested}</Message> : null}

      {host.requested === null ? (
        <Actions direction="stack">
          {confirming === null ? (
            <>
              <Button block disabled={host.busy || status === null || !status.canRestart} onClick={() => setConfirming("restart")}>
                Restart
              </Button>
              <Button
                variant="danger"
                block
                disabled={host.busy || status === null || !status.canShutdown}
                onClick={() => setConfirming("shutdown")}
              >
                Shutdown
              </Button>
            </>
          ) : (
            <>
              <Button
                variant={confirming === "shutdown" ? "danger" : "primary"}
                block
                loading={host.busy}
                onClick={() => void host.run(confirming)}
              >
                confirm {LABELS[confirming].toLowerCase()}
              </Button>
              <Button block onClick={() => setConfirming(null)} disabled={host.busy}>
                cancel
              </Button>
            </>
          )}
        </Actions>
      ) : null}
    </Panel>
  );
}
