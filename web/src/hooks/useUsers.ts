import { useCallback, useEffect, useState } from "react";
import { ApiError, createUser, deleteUser, fetchUsers, updateUser } from "../api";
import type { CreateUserRequest, PublicUser, UpdateUserRequest } from "../../../src/types";

export interface UsersController {
  users: PublicUser[];
  error: string | null;
  busy: boolean;
  create: (input: CreateUserRequest) => Promise<boolean>;
  change: (id: number, input: UpdateUserRequest) => Promise<boolean>;
  remove: (id: number) => Promise<boolean>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

/**
 * The account list, with every mutation reported back instead of thrown: an admin fixing
 * a typo in a login needs the server's reason on the form, not a crash in the page.
 * The boolean return tells the caller whether the account it just touched is still valid.
 *
 * A 401 is deliberately not reported here. Changing your own role or password revokes the
 * token in use, and that is a sign-in question the app answers by re-reading the session -
 * the poll loop does the same for any other expired token.
 */
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
