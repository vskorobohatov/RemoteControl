import type { UpdateStatus } from "@server/types";
import { Actions } from "@shared/ui/Actions";
import { Button } from "@shared/ui/Button";
import { Modal } from "@shared/ui/Modal";
import styles from "./ForceUpdateModal.module.scss";

interface Consequence {
  what: string;
  effect: string;
}

function consequences(status: UpdateStatus): Consequence[] {
  const items: Consequence[] = [];
  if (status.dirty) {
    items.push({
      what: "uncommitted changes",
      effect: "they are moved to a git stash on the host; git stash pop there brings them back",
    });
  }
  if (status.ahead > 0) {
    items.push({
      what: `${status.ahead} local commit(s)`,
      effect: `they stay on '${status.branch ?? "the current checkout"}' and will not be part of this update`,
    });
  }
  if (status.branch === null) {
    items.push({
      what: "detached HEAD",
      effect: "the update checks out the release branch and re-attaches HEAD",
    });
  }
  return items;
}

interface ForceUpdateModalProps {
  status: UpdateStatus;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ForceUpdateModal({ status, busy, onCancel, onConfirm }: ForceUpdateModalProps) {
  const items = consequences(status);
  const target = status.target;

  return (
    <Modal
      kicker="blocked update"
      title={"Force update to " + (target === null ? "the newest release" : "v" + target.version)}
      description={"The plain update from v" + status.currentVersion + " is blocked:"}
      onClose={onCancel}
    >
      <ul className={styles.list}>
        {items.map((item) => (
          <li key={item.what}>
            <strong>{item.what}</strong>
            <span>{item.effect}</span>
          </li>
        ))}
      </ul>
      <p className={styles.warning}>
        A forced update never merges and never deletes: it stashes what is stashed and leaves what stays on its own
        branch. Review it on the host afterwards if anything here is unexpected.
      </p>
      <Actions>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          cancel
        </Button>
        <Button variant="danger" onClick={onConfirm} disabled={busy} loading={busy}>
          force update
        </Button>
      </Actions>
    </Modal>
  );
}
