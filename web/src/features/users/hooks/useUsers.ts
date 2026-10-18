import { useCallback, useEffect, useState } from "react";
import type { CreateUserRequest, PublicUser, UpdateUserRequest } from "@server/types";
import { isUnauthorized, messageOf } from "@shared/api/client";
import { createUser, deleteUser, fetchUsers, updateUser } from "../api";

export interface UsersController {
  users: PublicUser[];
  error: string | null;
  busy: boolean;
  create: (input: CreateUserRequest) => Promise<boolean>;
  change: (id: number, input: UpdateUserRequest) => Promise<boolean>;
  remove: (id: number) => Promise<boolean>;
}

export function useUsers(enabled: boolean): UsersController {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      setUsers((await fetchUsers()).users);
      return true;
    } catch (caught) {
      if (!isUnauthorized(caught)) {
        setError(messageOf(caught));
      }
      return false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    void refresh();
  }, [enabled, refresh]);

  const run = useCallback(
    async (action: () => Promise<void>): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        /* refresh() never throws: a list it cannot read is not the mutation failing. */
        await action();
        await refresh();
        return true;
      } catch (caught) {
        setError(messageOf(caught));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const create = useCallback(
    (input: CreateUserRequest) => run(async () => void (await createUser(input))),
    [run],
  );

  const change = useCallback(
    (id: number, input: UpdateUserRequest) => run(async () => void (await updateUser(id, input))),
    [run],
  );

  const remove = useCallback(
    (id: number) => run(async () => void (await deleteUser(id))),
    [run],
  );

  return { users, error, busy, create, change, remove };
}
