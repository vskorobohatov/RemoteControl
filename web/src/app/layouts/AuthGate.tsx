import { useState, type FormEvent } from "react";
import { Button } from "@shared/ui/Button";
import { Message } from "@shared/ui/Message";
import { PasswordInput, TextInput } from "@shared/ui/TextInput";
import { Card } from "@shared/ui/Card";
import { useRemoteControlContext } from "../providers/RemoteControlContext";
import styles from "./AuthGate.module.scss";

export function AuthGate() {
  const { status, needsBootstrap, signIn, createFirstAccount } = useRemoteControlContext();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (needsBootstrap) {
        await createFirstAccount(login, password);
      } else {
        await signIn(login, password);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={styles.gate}>
      <Card className={styles.card} as="form" onSubmit={submit}>
        <p className={styles.kicker}>{needsBootstrap ? "first run" : "sign in"}</p>
        <h1 className={styles.title}>{needsBootstrap ? "Create the owner account" : "RemoteControl"}</h1>

        <p className={styles.copy}>
          {needsBootstrap
            ? "This instance has no accounts yet. The first account created becomes the owner and can manage the others."
            : "Enter with the account created on this machine."}
        </p>

        <div className={styles.fields}>
          <TextInput
            label="login"
            value={login}
            onChange={(event) => setLogin(event.target.value)}
            autoComplete="username"
            autoFocus
            required
            minLength={3}
          />
          <PasswordInput
            label="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={needsBootstrap ? "new-password" : "current-password"}
            required
            minLength={8}
          />
        </div>

        {error !== null ? <Message tone="danger">{error}</Message> : null}

        <Button type="submit" variant="primary" loading={busy} disabled={busy}>
          {needsBootstrap ? "create owner" : "sign in"}
        </Button>

        {status === "offline" ? (
          <p className={styles.note}>The service is not reachable. The form stays open until it answers.</p>
        ) : null}
      </Card>
    </main>
  );
}
