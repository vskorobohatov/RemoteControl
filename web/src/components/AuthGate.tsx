import { useState } from "react";

export type AuthMode = "bootstrap" | "login";

const COPY: Record<AuthMode, { title: string; copy: string; submit: string }> = {
  bootstrap: {
    title: "Create the first account",
    copy: "This server has no accounts yet. The one you create here is the first admin - it is the only time an account can be created without signing in.",
    submit: "Create admin",
  },
  login: {
    title: "Sign in",
    copy: "Accounts decide what the console lets you do: an admin runs everything, a manager runs the services, a guest only watches.",
    submit: "Sign in",
  },
};

export function AuthGate({
  mode,
  error,
  onSubmit,
  onRetry,
}: {
  mode: AuthMode;
  error: string | null;
  onSubmit: (login: string, password: string) => Promise<void>;
  onRetry: () => void;
}) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const copy = COPY[mode];

  const submit = async () => {
    setBusy(true);
    setFailure(null);
    try {
      await onSubmit(login.trim(), password);
    } catch (caught) {
      /* The server already words these for people: wrong password, weak password, bad login. */
      setFailure(caught instanceof Error ? caught.message : String(caught));
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="gate">
      <form
        className="gate-card"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p className="gate-kicker">RemoteControl</p>
        <h1 className="gate-title">{copy.title}</h1>
        <p className="gate-copy">{copy.copy}</p>

        <label className="gate-field">
          <span>Login</span>
          <input
            type="text"
            value={login}
            autoFocus
            autoComplete="username"
            spellCheck={false}
            placeholder="lowercase letters, digits, dot, dash or underscore"
            onChange={(event) => setLogin(event.target.value)}
          />
        </label>

        <label className="gate-field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            autoComplete={mode === "bootstrap" ? "new-password" : "current-password"}
            placeholder="at least 10 characters"
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {failure !== null ? <p className="gate-error">{failure}</p> : null}
        {failure === null && error !== null ? <p className="gate-error">{error}</p> : null}

        <button
          className="gate-submit"
          type="submit"
          disabled={busy || login.trim().length === 0 || password.length === 0}
        >
          {busy ? "…" : copy.submit}
        </button>

        {/* The server may simply not be there yet; asking again is the whole recovery. */}
        {failure === null && error !== null ? (
          <button className="btn btn--ghost gate-retry" type="button" onClick={onRetry}>
            retry
          </button>
        ) : null}

        <p className="gate-note">
          The session token is kept in this browser only and stops working when it expires or you sign out.
        </p>
      </form>
    </main>
  );
}
