import { useState, type FormEvent } from "react";
import { USER_ROLES, type UserRole } from "@server/types";
import { Actions } from "@shared/ui/Actions";
import { Button } from "@shared/ui/Button";
import { Message } from "@shared/ui/Message";
import { Modal } from "@shared/ui/Modal";
import { Select } from "@shared/ui/Select";
import { PasswordInput, TextInput } from "@shared/ui/TextInput";
import { MIN_LOGIN_LENGTH, MIN_PASSWORD_LENGTH } from "../draft";
import styles from "./UserCreateModal.module.scss";

interface UserCreateModalProps {
  busy: boolean;
  error: string | null;
  onCreate: (input: { login: string; password: string; role: UserRole }) => Promise<boolean>;
  onClose: () => void;
}

export function UserCreateModal({ busy, error, onCreate, onClose }: UserCreateModalProps) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("guest");

  const valid = login.trim().length >= MIN_LOGIN_LENGTH && password.length >= MIN_PASSWORD_LENGTH;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!valid) {
      return;
    }
    if (await onCreate({ login: login.trim(), password, role })) {
      onClose();
    }
  };

  return (
    <Modal
      kicker="New account"
      title="Add user"
      description="The role decides what this account may do once it signs in, and it can be changed later from this list."
      onClose={onClose}
    >
      <form className={styles.form} onSubmit={submit}>
        <TextInput
          label="login"
          value={login}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          placeholder="lowercase letters, digits, dot, dash or underscore"
          onChange={(event) => setLogin(event.target.value)}
        />
        <PasswordInput
          label="password"
          value={password}
          autoComplete="new-password"
          placeholder="at least 10 characters"
          onChange={(event) => setPassword(event.target.value)}
        />
        <Select
          label="role"
          options={USER_ROLES}
          value={role}
          size="lg"
          onChange={(value) => setRole(value as UserRole)}
        />

        {error !== null ? <Message tone="danger">{error}</Message> : null}

        <Actions>
          <Button type="submit" variant="success" size="lg" block loading={busy} disabled={!valid} className={styles.submit}>
            create account
          </Button>
          <Button size="lg">cancel</Button>
        </Actions>
      </form>
    </Modal>
  );
}
