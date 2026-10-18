import { Actions } from "@shared/ui/Actions";
import { Button } from "@shared/ui/Button";
import { Panel, PanelHeader } from "@shared/ui/Panel";
import type { UpdateController } from "../hooks/useUpdate";
import styles from "./UpdateActions.module.scss";

export function UpdateActions({ update, canApply }: { update: UpdateController; canApply: boolean }) {
  const { status, busy, checkBusy, check, apply, reset } = update;
  const run = status?.lastRun ?? null;
  const canReset = run !== null && run.status !== "running";

  return (
    <Panel>
      <PanelHeader title="Update actions" meta={busy ? "working…" : "idle"} />

      <p className={styles.note}>
        “Update now” checks out the newest release branch, pulls it, rebuilds and restarts the server. This page
        reloads itself once the new version answers.
      </p>

      <Actions direction="stack">
        <Button block onClick={() => void check()} disabled={checkBusy}>
          Check for updates
        </Button>
        {canReset && canApply ? (
          <Button block onClick={() => void reset()} disabled={busy}>
            reset panel
          </Button>
        ) : null}
        <Button
          variant="success"
          block
          onClick={() => void apply()}
          disabled={busy || !canApply || !status?.canApply}
          title={canApply ? undefined : "only an admin may apply an update"}
        >
          Update now
        </Button>
      </Actions>
    </Panel>
  );
}
