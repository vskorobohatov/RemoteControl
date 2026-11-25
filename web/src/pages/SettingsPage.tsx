import { PageColumn, PageGrid } from "@app/layouts/PageLayout";
import { useRemoteControlContext } from "@app/providers/RemoteControlContext";
import { ControlsPanel } from "@features/host/components/ControlsPanel";
import { UpdateActions } from "@features/update/components/UpdateActions";
import { UpdatePanel } from "@features/update/components/UpdatePanel";
import { useUpdate } from "@features/update/hooks/useUpdate";
import { Counter } from "@shared/ui/Status";

export function SettingsPage() {
  const rc = useRemoteControlContext();
  const update = useUpdate();

  return (
    <PageGrid>
      <PageColumn
        title="Settings"
        counters={
          <>
            <Counter>release branches</Counter>
            <Counter>self-update</Counter>
          </>
        }
      >
        <UpdatePanel update={update} />
      </PageColumn>

      <PageColumn variant="side">
        {rc.can("host:control") ? <ControlsPanel system={rc.system} /> : null}
        <UpdateActions update={update} canApply={rc.can("update:apply")} />
      </PageColumn>
    </PageGrid>
  );
}
