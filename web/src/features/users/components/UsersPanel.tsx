import { useMemo, useState } from "react";
import { USER_ROLES, type PublicUser, type UserRole } from "@server/types";
import { Button } from "@shared/ui/Button";
import { EmptyState } from "@shared/ui/Actions";
import { Message } from "@shared/ui/Message";
import { Panel, PanelHeader } from "@shared/ui/Panel";
import { Select, type SelectOption } from "@shared/ui/Select";
import { TextInput } from "@shared/ui/TextInput";
import { draftFor, emptyDraft, toPatch, type UserDraft } from "../draft";
import type { UsersController } from "../hooks/useUsers";
import { UserCard } from "./UserCard";
import { UserCreateModal } from "./UserCreateModal";
import styles from "./UsersPanel.module.scss";

type RoleFilter = UserRole | "all";

const ROLE_OPTIONS: readonly (string | SelectOption)[] = [
  { value: "all", label: "all" },
  ...USER_ROLES,
];

export function UsersPanel({ users, currentUserId }: { users: UsersController; currentUserId: number }) {
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<UserDraft>(emptyDraft());

  const { error, busy } = users;
  const filtersActive = query.trim().length > 0 || roleFilter !== "all";

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return users.users.filter((user) => {
      if (roleFilter !== "all" && user.role !== roleFilter) {
        return false;
      }
      return needle.length === 0 || user.login.toLowerCase().includes(needle);
    });
  }, [users.users, query, roleFilter]);

  const startEdit = (user: PublicUser) => {
    setEditing(user.id);
    setDraft(draftFor(user));
  };

  const clearFilters = () => {
    setQuery("");
    setRoleFilter("all");
  };

  /* A role filter that would hide the account just created is a dead end, so it steps
     aside instead of swallowing the account the admin made. */
  const create = async (input: { login: string; password: string; role: UserRole }) => {
    const ok = await users.create(input);
    if (ok && roleFilter !== "all" && roleFilter !== input.role) {
      setRoleFilter("all");
    }
    return ok;
  };

  const save = async (id: number) => {
    if (await users.change(id, toPatch(draft))) {
      setEditing(null);
    }
  };

  return (
    <Panel>
      <PanelHeader
        title="Accounts"
        meta={`${filtersActive ? `${visible.length} of ${users.users.length}` : `${users.users.length}`} accounts`}
      />

      <div className={styles.toolbar} role="search">
        <TextInput
          className={styles.search}
          size="sm"
          label="search login"
          type="search"
          value={query}
          spellCheck={false}
          autoComplete="off"
          placeholder="part of a login"
          onChange={(event) => setQuery(event.target.value)}
        />

        <Select
          className={styles.role}
          size="sm"
          label="role"
          options={ROLE_OPTIONS}
          value={roleFilter}
          onChange={(value) => setRoleFilter(value as RoleFilter)}
        />

        {filtersActive ? <Button size="sm" onClick={clearFilters}>clear</Button> : null}

        <Button className={styles.add} size="sm" onClick={() => setCreating(true)}>
          + add user
        </Button>
      </div>

      <p className={styles.note}>
        admin runs everything including these accounts · manager runs the services and reads the telemetry · guest only
        sees what is running. Changing a role signs that account&apos;s sessions out.
      </p>

      {/* While the dialog is open, its own copy of the message is the one worth reading. */}
      {error !== null && !creating ? <Message tone="danger">{error}</Message> : null}

      {visible.length === 0 ? (
        <EmptyState variant="inline">
          {filtersActive ? "no accounts match this search or role." : "no accounts yet - add the first one."}
        </EmptyState>
      ) : (
        <div className={styles.list}>
          {visible.map((user) => (
            <UserCard
              key={user.id}
              user={user}
              busy={busy}
              isSelf={user.id === currentUserId}
              draft={editing === user.id ? draft : null}
              onEdit={startEdit}
              onDraft={setDraft}
              onClose={() => setEditing(null)}
              onSave={save}
              onRemove={users.remove}
            />
          ))}
        </div>
      )}

      {creating ? (
        <UserCreateModal busy={busy} error={error} onCreate={create} onClose={() => setCreating(false)} />
      ) : null}
    </Panel>
  );
}
