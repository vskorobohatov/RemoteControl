import { PageColumn, PageGrid } from "@app/layouts/PageLayout";
import { useRemoteControlContext } from "@app/providers/RemoteControlContext";
import { RuntimePanel } from "@features/system/components/RuntimePanel";
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
        <RuntimePanel system={rc.system} sampleIntervalMs={rc.sampleIntervalMs} />
        <UpdateActions update={update} canApply={rc.can("update:apply")} />
      </PageColumn>
    </PageGrid>
  );
}
