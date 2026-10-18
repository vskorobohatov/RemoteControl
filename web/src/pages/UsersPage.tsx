import { PageGrid } from "@app/layouts/PageLayout";
import { useRemoteControlContext } from "@app/providers/RemoteControlContext";
import { UsersPanel } from "@features/users/components/UsersPanel";
import { useUsers, type UsersController } from "@features/users/hooks/useUsers";

export function UsersPage() {
  const rc = useRemoteControlContext();
  const currentUserId = rc.session?.user.id ?? 0;
  const users = useUsers(rc.can("users:manage"));

  const settle = async (ok: boolean, id: number) => {
    if (ok && id === currentUserId) {
      await rc.refreshSession();
    }
    return ok;
  };

  const bound: UsersController = {
    ...users,
    change: async (id, input) => settle(await users.change(id, input), id),
    remove: async (id) => settle(await users.remove(id), id),
  };

  return (
    <PageGrid single>
      <UsersPanel users={bound} currentUserId={currentUserId} />
    </PageGrid>
  );
}

