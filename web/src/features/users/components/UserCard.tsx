import { USER_ROLES, type PublicUser, type UserRole } from "@server/types";
import { RoleTag } from "@features/auth/components/RoleTag";
import { Actions } from "@shared/ui/Actions";
import { Button } from "@shared/ui/Button";
import { Card } from "@shared/ui/Card";
import { Facts } from "@shared/ui/Facts";
import { Select } from "@shared/ui/Select";
import { Tag } from "@shared/ui/Status";
import { PasswordInput, TextInput } from "@shared/ui/TextInput";
import { formatClock } from "@shared/lib/format";
import type { UserDraft } from "../draft";
import styles from "./UserCard.module.scss";

interface UserCardProps {
  user: PublicUser;
  busy: boolean;
  isSelf: boolean;
  draft: UserDraft | null;
  onEdit: (user: PublicUser) => void;
  onDraft: (draft: UserDraft) => void;
  onClose: () => void;
  onSave: (id: number) => Promise<void>;
  onRemove: (id: number) => Promise<boolean>;
}

export function UserCard({ user, busy, isSelf, draft, onEdit, onDraft, onClose, onSave, onRemove }: UserCardProps) {
  const editing = draft !== null;
  const role = editing ? draft.role : user.role;

  return (
    <Card outline={isSelf ? "external" : undefined} raised={editing}>
      <header className={styles.head}>
        <span className={styles.login}>{user.login}</span>
        <RoleTag role={role} />
        {isSelf ? <Tag tone="external">you</Tag> : null}
      </header>

      {editing ? (
        <div className={styles.edit}>
          <TextInput
            label="login"
            value={draft.login}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => onDraft({ ...draft, login: event.target.value })}
          />
          <Select
            label="role"
            options={USER_ROLES}
            value={draft.role}
            onChange={(value) => onDraft({ ...draft, role: value as UserRole })}
          />
          <PasswordInput
            label="new password · empty keeps the current one"
            value={draft.password}
            autoComplete="new-password"
            placeholder="at least 10 characters"
            onChange={(event) => onDraft({ ...draft, password: event.target.value })}
          />
        </div>
      ) : (
        <Facts
          items={[
            { label: "created", value: formatClock(user.createdAt) },
            { label: "last login", value: formatClock(user.lastLoginAt) },
          ]}
        />
      )}

      <Actions>
        {editing ? (
          <>
            <Button variant="success" disabled={busy} onClick={() => void onSave(user.id)}>
              save
            </Button>
            <Button onClick={onClose}>cancel</Button>
          </>
        ) : (
          <>
            <Button onClick={() => onEdit(user)}>edit</Button>
            <Button
              variant="danger"
              disabled={busy || isSelf}
              title={isSelf ? "you cannot delete the account you are signed in with" : undefined}
              onClick={() => void onRemove(user.id)}
            >
              delete
            </Button>
          </>
        )}
      </Actions>
    </Card>
  );
}
