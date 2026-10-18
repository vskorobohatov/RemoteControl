import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { USER_ROLES, type UserRole } from "../../../src/types";

/* The client-side gate exists only to keep the button honest. Every real rejection -
   a taken login, a weak password, a bad character - is the server's to word. */
const MIN_LOGIN_LENGTH = 2;
const MIN_PASSWORD_LENGTH = 10;

/**
 * The create-account dialog. A native <dialog> opened with showModal(), so Escape, the
 * backdrop click and the focus trap are the browser's behaviour and not ours to rebuild.
 * A failed create leaves it open with the server's reason inside it.
 */
export function UserCreateModal({
  busy,
  error,
  onCreate,
  onClose,
}: {
  busy: boolean;
  error: string | null;
  onCreate: (input: { login: string; password: string; role: UserRole }) => Promise<boolean>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("guest");

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const valid = login.trim().length >= MIN_LOGIN_LENGTH && password.length >= MIN_PASSWORD_LENGTH;

  /* The backdrop is a pseudo-element, so a click on it arrives at the dialog itself while
     a click anywhere inside the card does not - that difference is the whole test. */
  const backdropClose = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === dialog.current) {
      onClose();
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!valid) {
      return;
    }
    /* Closing on success discards the half-typed values with the dialog. */
    if (await onCreate({ login: login.trim(), password, role })) {
      onClose();
    }
  };

  return (
    <dialog ref={dialog} className="modal" onClick={backdropClose} onClose={onClose}>
      <form className="modal-card" onSubmit={submit}>
        <p className="gate-kicker">New account</p>
        <h3 className="gate-title">Add user</h3>
        <p className="gate-copy">
          The role decides what this account may do once it signs in, and it can be changed later from this list.
        </p>

        <label className="gate-field">
          <span>login</span>
          <input
            type="text"
            value={login}
            autoFocus
            spellCheck={false}
            autoComplete="off"
            placeholder="lowercase letters, digits, dot, dash or underscore"
            onChange={(event) => setLogin(event.target.value)}
          />
        </label>

        <label className="gate-field">
          <span>password</span>
          <input
            type="password"
            value={password}
            autoComplete="new-password"
            placeholder="at least 10 characters"
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        <label className="gate-field">
          <span>role</span>
          <select value={role} onChange={(event) => setRole(event.target.value as UserRole)}>
            {USER_ROLES.map((value) => (
              <option value={value} key={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        {error !== null ? <p className="gate-error">{error}</p> : null}

        <div className="modal-actions">
          <button className="gate-submit" type="submit" disabled={busy || !valid}>
            {busy ? "…" : "create account"}
          </button>
          <button className="btn btn--ghost" type="button" onClick={onClose}>
            cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}
