import { readFileSync } from "node:fs";
import path from "node:path";
import { ConfigError, loadConfig } from "./config.js";
import { EventBus } from "./lib/bus.js";
import { GpuSampler } from "./metrics/gpu.js";
import { MetricsSampler } from "./metrics/sampler.js";
import { MetricsStore } from "./metrics/store.js";
import { createServer } from "./api/server.js";
import { collectSystemInfo } from "./systeminfo.js";
import { ServiceManager } from "./services/manager.js";

const rootDir = path.resolve(process.env.RC_ROOT_DIR ?? process.cwd());
const startedAt = Date.now();

function readAppVersion(): string {
  try {
    const raw = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8")) as { version?: string };
    return raw.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function main(): Promise<void> {
  const config = loadConfig(rootDir);
  const bus = new EventBus();
  const store = new MetricsStore(config.metrics.retentionMinutes * 60_000);
  const sampler = new MetricsSampler(config.metrics, store, bus);
  const services = new ServiceManager(config, bus);
  const systemInfo = await collectSystemInfo(new GpuSampler(config.metrics.gpu), readAppVersion(), startedAt);

  const app = await createServer({ config, bus, store, services, systemInfo, startedAt });

  await services.adoptRunningUnits();
  sampler.start();

  const statusTimer = setInterval(() => {
    void services.refreshAll().catch((error: unknown) => {
      app.log.warn({ err: error }, "service status refresh failed");
    });
  }, config.metrics.statusIntervalMs);

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
    clearInterval(statusTimer);
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
