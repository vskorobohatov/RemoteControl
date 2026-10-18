import { UpdateActions } from "../components/UpdateActions";
import { UpdatePanel } from "../components/UpdatePanel";
import { useRemoteControlContext } from "../context/RemoteControlProvider";
import { useUpdate } from "../hooks/useUpdate";
import { formatBytes, formatClock, formatUptime } from "../format";
import type { SystemResponse } from "../api";

export function SettingsPage() {
  const rc = useRemoteControlContext();
  const update = useUpdate();

  return (
    <main className="grid">
      <section className="column column--services">
        <div className="column-head">
          <h2 className="column-title">Settings</h2>
          <div className="counters">
            <span className="counter">release branches</span>
            <span className="counter">self-update</span>
          </div>
        </div>

        <UpdatePanel update={update} />
      </section>

      <aside className="column column--telemetry">
        <RuntimePanel system={rc.system} sampleIntervalMs={rc.sampleIntervalMs} />
        <UpdateActions update={update} canApply={rc.can("update:apply")} />
      </aside>
    </main>
  );
}

function RuntimePanel({
  system,
  sampleIntervalMs,
}: {
  system: SystemResponse | null;
  sampleIntervalMs: number | null;
}) {
  if (system === null) {
    return (
      <section className="panel">
        <h2 className="panel-title">Runtime</h2>
        <p className="panel-empty">waiting for the system report…</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <header className="panel-head">
        <h2 className="panel-title">Runtime</h2>
        <span className="panel-clock">v{system.appVersion}</span>
      </header>
      <dl className="facts">
        <div>
          <dt>host</dt>
          <dd>{system.hostname}</dd>
        </div>
        <div>
          <dt>kernel</dt>
          <dd>{system.kernel}</dd>
        </div>
        <div>
          <dt>cpu</dt>
          <dd>
            {system.cpuModel} · {system.logicalCores} cores
          </dd>
        </div>
        <div>
          <dt>memory</dt>
          <dd>{formatBytes(system.memoryTotalBytes)}</dd>
        </div>
        <div>
          <dt>gpu</dt>
          <dd>{system.gpuModel ?? "none detected"}</dd>
        </div>
        <div>
          <dt>server up since</dt>
          <dd>
            {formatClock(system.startedAt)} · {formatUptime(system.uptimeSeconds)}
          </dd>
        </div>
        <div>
          <dt>config</dt>
          <dd>{system.server.configPath}</dd>
        </div>
        <div>
          <dt>sample interval</dt>
          <dd>{sampleIntervalMs === null ? "—" : `${Math.round(sampleIntervalMs)}ms`}</dd>
        </div>
      </dl>
    </section>
  );
}