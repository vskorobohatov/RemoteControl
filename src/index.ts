import path from "node:path";
import { readAppVersion } from "./appVersion.js";
import { ConfigError, loadConfig } from "./config.js";
import { EventBus } from "./lib/bus.js";
import { GpuSampler } from "./metrics/gpu.js";
import { MetricsSampler } from "./metrics/sampler.js";
import { MetricsStore } from "./metrics/store.js";
import { createServer } from "./api/server.js";
import { collectSystemInfo } from "./systeminfo.js";
import { ServiceManager } from "./services/manager.js";
import { UpdateService } from "./update/service.js";

const rootDir = path.resolve(process.env.RC_ROOT_DIR ?? process.cwd());
const startedAt = Date.now();

async function main(): Promise<void> {
  const config = loadConfig(rootDir);
  const bus = new EventBus();
  const store = new MetricsStore(config.metrics.retentionMinutes * 60_000);
  const sampler = new MetricsSampler(config.metrics, store, bus);
  const services = new ServiceManager(config, bus);
  const updates = new UpdateService(config, bus);
  const systemInfo = await collectSystemInfo(new GpuSampler(config.metrics.gpu), readAppVersion(rootDir), startedAt);

  const app = await createServer({ config, bus, store, services, updates, systemInfo, startedAt });

  await services.adoptRunningUnits();
  sampler.start();

  const timers: NodeJS.Timeout[] = [];

  const statusTimer = setInterval(() => {
    void services.refreshAll().catch((error: unknown) => {
      app.log.warn({ err: error }, "service status refresh failed");
    });
  }, config.metrics.statusIntervalMs);
  timers.push(statusTimer);

  if (config.update.enabled && config.update.autoCheckMinutes > 0) {
    const checkTimer = setInterval(() => {
      void updates.check().catch((error: unknown) => {
        app.log.warn({ err: error }, "update check failed");
      });
    }, config.update.autoCheckMinutes * 60_000);
    checkTimer.unref();
    timers.push(checkTimer);
  }

  await app.listen({ host: config.server.host, port: config.server.port });
  app.log.info(
    { host: config.server.host, port: config.server.port, services: config.services.length },
    "RemoteControl server listening",
  );

  let closing = false;
  const shutdown = (signal: string): void => {
    if (closing) {
      return;
    }
    closing = true;
    app.log.info({ signal }, "shutting down");
    for (const timer of timers) {
      clearInterval(timer);
    }
    sampler.stop();
    void app
      .close()
      .catch((error: unknown) => app.log.error({ err: error }, "shutdown failed"))
      .finally(() => process.exit(0));
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  const message = error instanceof ConfigError ? `config error: ${error.message}` : String(error);
  console.error(message);
  process.exit(1);
});
