import { UsersPanel } from "../components/UsersPanel";
import { useRemoteControlContext } from "../context/RemoteControlProvider";
import { useUsers } from "../hooks/useUsers";
import type { CreateUserRequest, UpdateUserRequest } from "../../../src/types";

/** Admin only, and reached through a nav link that only admins are shown. */
export function UsersPage() {
  const rc = useRemoteControlContext();
  const currentUserId = rc.session?.user.id ?? 0;
  const users = useUsers(rc.can("users:manage"));

  /* Changing your own role ends the session you are reading the page with, so re-read
     it: either the new permissions apply or the sign-in gate comes back. */
  const settle = async (ok: boolean, id: number) => {
    if (ok && id === currentUserId) {
      await rc.refreshSession();
    }
    return ok;
  };

  const create = async (input: CreateUserRequest) => users.create(input);
  const change = async (id: number, input: UpdateUserRequest) => settle(await users.change(id, input), id);
  const remove = async (id: number) => settle(await users.remove(id), id);

  return (
    <main className="grid grid--single">
      <UsersPanel
        users={users.users}
        busy={users.busy}
        error={users.error}
        currentUserId={currentUserId}
        onCreate={create}
        onChange={change}
        onRemove={remove}
      />
    </main>
  );
}
