import { useState } from "react";

export function TokenGate({ onSubmit }: { onSubmit: (token: string) => void }) {
  const [value, setValue] = useState("");

  return (
    <main className="gate">
      <form
        className="gate-card"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(value);
        }}
      >
        <p className="gate-kicker">RemoteControl</p>
        <h1 className="gate-title">Service console</h1>
        <p className="gate-copy">
          The API is protected by a bearer token. Provide it once and it is kept in this browser only.
        </p>
        <label className="gate-field">
          <span>Access token</span>
          <input
            type="password"
            value={value}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            placeholder="auth.token from config/config.yaml"
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        <button className="gate-submit" type="submit" disabled={value.trim().length === 0}>
          Connect
        </button>
      </form>
    </main>
  );
}
