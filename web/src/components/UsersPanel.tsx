import { useMemo, useState } from "react";
import { USER_ROLES, type PublicUser, type UserRole } from "../../../src/types";
import { formatClock } from "../format";
import { UserCreateModal } from "./UserCreateModal";

interface Draft {
  login: string;
  password: string;
  role: UserRole;
}

/** The role filter's "everything" option. It is not a role the server knows. */
type RoleFilter = UserRole | "all";

/**
 * Admin-only account editor. Editing an account here can sign that account out on the
 * next request, and that is the intended behaviour rather than a surprise: a token
 * carries the role it was issued for.
 *
 * The header filters are a view over the list the page already has - `GET /api/users`
 * takes no query parameters - and creating an account happens in the dialog the header
 * opens, never inline.
 */
export function UsersPanel({
  users,
  busy,
  error,
  currentUserId,
  onCreate,
  onChange,
  onRemove,
}: {
  users: PublicUser[];
  busy: boolean;
  error: string | null;
  currentUserId: number;
  onCreate: (input: { login: string; password: string; role: UserRole }) => Promise<boolean>;
  onChange: (id: number, input: { login?: string; role?: UserRole; password?: string }) => Promise<boolean>;
  onRemove: (id: number) => Promise<boolean>;
}) {
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>({ login: "", password: "", role: "guest" });

  const filtersActive = query.trim().length > 0 || roleFilter !== "all";

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return users.filter((user) => {
      if (roleFilter !== "all" && user.role !== roleFilter) {
        return false;
      }
      return needle.length === 0 || user.login.toLowerCase().includes(needle);
    });
  }, [users, query, roleFilter]);

  const startEdit = (user: PublicUser) => {
    setEditing(user.id);
    setDraft({ login: user.login, password: "", role: user.role });
  };

  const clearFilters = () => {
    setQuery("");
    setRoleFilter("all");
  };

  /* A role filter that would hide the account just created is a dead end, so it steps
     aside instead of swallowing the account the admin made. */
  const create = async (input: { login: string; password: string; role: UserRole }) => {
    const ok = await onCreate(input);
    if (ok && roleFilter !== "all" && roleFilter !== input.role) {
      setRoleFilter("all");
    }
    return ok;
  };

  const save = async (id: number) => {
    const input: { login?: string; role?: UserRole; password?: string } = { role: draft.role };
    if (draft.login.trim().length > 0) {
      input.login = draft.login.trim();
    }
    if (draft.password.length > 0) {
      input.password = draft.password;
    }
    if (await onChange(id, input)) {
      setEditing(null);
    }
  };

  return (
    <section className="panel panel--users">
      <header className="panel-head">
        <h2 className="panel-title">Accounts</h2>
        <span className="panel-clock">
          {filtersActive ? `${visible.length} of ${users.length}` : `${users.length}`} accounts
        </span>
      </header>

      <div className="user-toolbar" role="search">
        <label className="user-field user-field--search">
          <span>search login</span>
          <input
            type="search"
            value={query}
            spellCheck={false}
            autoComplete="off"
            placeholder="part of a login"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <label className="user-field user-field--role">
          <span>role</span>
          <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as RoleFilter)}>
            <option value="all">all</option>
            {USER_ROLES.map((value) => (
              <option value={value} key={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        {filtersActive ? (
          <button className="btn btn--ghost" type="button" onClick={clearFilters}>
            clear
          </button>
        ) : null}

        <button className="btn btn--add" type="button" onClick={() => setCreating(true)}>
          + add user
        </button>
      </div>

      <p className="update-note">
        admin runs everything including these accounts · manager runs the services and reads the telemetry · guest
        only sees what is running. Changing a role signs that account&apos;s sessions out.
      </p>

      {/* While the dialog is open, its own copy of the message is the one worth reading. */}
      {error !== null && !creating ? <p className="update-message update-message--error">{error}</p> : null}

      {visible.length === 0 ? (
        <p className="panel-empty">
          {filtersActive ? "no accounts match this search or role." : "no accounts yet - add the first one."}
        </p>
      ) : (
        <div className="user-list">
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
              onRemove={onRemove}
            />
          ))}
        </div>
      )}

      {creating ? (
        <UserCreateModal busy={busy} error={error} onCreate={create} onClose={() => setCreating(false)} />
      ) : null}
    </section>
  );
}


function UserCard({
  user,
  busy,
  isSelf,
  draft,
  onEdit,
  onDraft,
  onClose,
  onSave,
  onRemove,
}: {
  user: PublicUser;
  busy: boolean;
  isSelf: boolean;
  draft: Draft | null;
  onEdit: (user: PublicUser) => void;
  onDraft: (draft: Draft) => void;
  onClose: () => void;
  onSave: (id: number) => Promise<void>;
  onRemove: (id: number) => Promise<boolean>;
}) {
  const editing = draft !== null;

  return (
    <article className={`user${isSelf ? " user--self" : ""}${editing ? " user--editing" : ""}`}>
      <div className="user-head">
        <span className="user-login">{user.login}</span>
        <span className={`role role--${editing ? draft.role : user.role}`}>{editing ? draft.role : user.role}</span>
        {isSelf ? <span className="tag tag--self">you</span> : null}
      </div>

      {editing ? (
        <div className="user-edit">
          <label className="gate-field">
            <span>login</span>
            <input
              type="text"
              value={draft.login}
              spellCheck={false}
              onChange={(event) => onDraft({ ...draft, login: event.target.value })}
            />
          </label>
          <label className="gate-field">
            <span>role</span>
            <select value={draft.role} onChange={(event) => onDraft({ ...draft, role: event.target.value as UserRole })}>
              {USER_ROLES.map((value) => (
                <option value={value} key={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="gate-field">
            <span>new password · empty keeps the current one</span>
            <input
              type="password"
              value={draft.password}
              autoComplete="new-password"
              placeholder="at least 10 characters"
              onChange={(event) => onDraft({ ...draft, password: event.target.value })}
            />
          </label>
        </div>
      ) : (
        <dl className="facts">
          <div>
            <dt>created</dt>
            <dd>{formatClock(user.createdAt)}</dd>
          </div>
          <div>
            <dt>last login</dt>
            <dd>{formatClock(user.lastLoginAt)}</dd>
          </div>
        </dl>
      )}

      <div className="service-actions">
        {editing ? (
          <>
            <button className="btn btn--start" type="button" disabled={busy} onClick={() => void onSave(user.id)}>
              save
            </button>
            <button className="btn btn--ghost" type="button" onClick={onClose}>
              cancel
            </button>
          </>
        ) : (
          <>
            <button className="btn btn--ghost" type="button" onClick={() => onEdit(user)}>
              edit
            </button>
            <button
              className="btn btn--stop"
              type="button"
              disabled={busy || isSelf}
              title={isSelf ? "you cannot delete the account you are signed in with" : undefined}
              onClick={() => void onRemove(user.id)}
            >
              delete
            </button>
          </>
        )}
      </div>
    </article>
  );
}
