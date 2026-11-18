import type { ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config.js";
import type { ServiceConfig } from "./types.js";
import { EventBus } from "../lib/bus.js";
import { runCommand } from "../lib/run.js";
import { checkHealth } from "./health.js";
import { UnknownServiceError } from "./errors.js";
import { resolveStartArgs, resolveStartApiKey } from "./model.js";
import { ApiKeyStore } from "./keystore.js";
import { serviceAccessLink } from "../lib/publicurl.js";
import { SystemdSupervisor } from "./systemd.js";
import type { ServiceExit } from "./systemd.js";
import type { ServiceState } from "../types.js";

export interface ManagedService {
  config: ServiceConfig;
  state: ServiceState;
  supervisor: ChildProcess | null;
  startedByUs: boolean;
  exited: boolean;
  stopRequested: boolean;
  readyConfirmed: boolean;
  startRequestedAt: number | null;
  busy: boolean;
}

function createManaged(config: AppConfig, serviceConfig: ServiceConfig): ManagedService {
  return {
    config: serviceConfig,
    state: {
      id: serviceConfig.id,
      name: serviceConfig.name,
      description: serviceConfig.description,
      status: "stopped",
      unit: serviceConfig.unit,
      managedBy: null,
      pid: null,
      startedAt: null,
      uptimeSeconds: null,
      lastExitCode: null,
      lastError: null,
      health: null,
      logPath: path.join(config.logDir, `${serviceConfig.id}.log`),
      link: serviceAccessLink(config.server.publicUrl, serviceConfig.id),
      modelOptions: serviceConfig.model
        ? serviceConfig.model.options.map((option) => ({ value: option.value, label: option.label }))
        : [],
      modelDefault: serviceConfig.model?.default ?? null,
      model: null,
      apiKeyEnv: serviceConfig.apiKeyEnv,
      apiKeyRemembered: false,
    },
    supervisor: null,
    startedByUs: false,
    exited: false,
    stopRequested: false,
    readyConfirmed: false,
    startRequestedAt: null,
    busy: false,
  };
}

export class ServiceManager {
  private readonly services = new Map<string, ManagedService>();
  readonly supervisor = new SystemdSupervisor();

  constructor(
    private readonly config: AppConfig,
    private readonly bus: EventBus,
    private readonly keys: ApiKeyStore,
  ) {
    mkdirSync(this.config.logDir, { recursive: true });
    for (const serviceConfig of this.config.services) {
      const managed = createManaged(this.config, serviceConfig);
      /* A key this service started with before this server came up is still its key. */
      managed.state.apiKeyRemembered = this.keys.get(serviceConfig.id) !== null;
      this.services.set(serviceConfig.id, managed);
    }
  }

  /** Forgets stored keys of services that the services file no longer names. */
  pruneStoredKeys(): number {
    return this.keys.pruneUnknown([...this.services.keys()]);
  }

  list(): ServiceState[] {
    return [...this.services.values()].map((service) => ({ ...service.state }));
  }

  get(id: string): ServiceState | null {
    const service = this.services.get(id);
    return service ? { ...service.state } : null;
  }

  protected(serviceId: string): ManagedService | undefined {
    return this.services.get(serviceId);
  }

  publish(service: ManagedService): void {
    service.state.uptimeSeconds =
      service.state.startedAt === null
        ? null
        : Math.max(0, Math.round((Date.now() - service.state.startedAt) / 1000));
    this.bus.publish("service", { ...service.state });
  }

  /** Adopt services already running, e.g. started by hand or before a server restart. */
  async adoptRunningUnits(): Promise<void> {
    for (const service of this.services.values()) {
      const properties = await this.supervisor.unitProperties(service.config.unit);
      if (properties.activeState !== "active") {
        continue;
      }
      service.startedByUs = false;
      service.readyConfirmed = false;
      service.state.status = service.config.health ? "starting" : "running";
      service.state.managedBy = "external";
      service.state.startedAt = properties.startedAtMs;
      service.state.lastError = null;
      this.publish(service);
    }
  }


  async start(id: string, model: string | null = null, apiKey: string | null = null): Promise<{ service: ServiceState; message: string }> {
    const service = this.services.get(id);
    if (!service) {
      throw new UnknownServiceError(id);
    }
    if (service.busy) {
      return { service: { ...service.state }, message: "operation already in progress" };
    }

    if (await this.supervisor.isActive(service.config.unit)) {
      await this.refresh(id);
      return { service: { ...service.state }, message: "already running" };
    }

    /* Resolved before anything changes: an unknown choice is a refusal, not a service
       that half started and then reports a failure. */
    const startArgs = resolveStartArgs(id, service.config.start, service.config.model, model, service.state.model);
    const key = resolveStartApiKey(id, service.config.apiKeyEnv, apiKey, this.keys.get(id)?.apiKey ?? null);
    const secretEnv: Record<string, string> =
      key === null || service.config.apiKeyEnv === null ? {} : { [service.config.apiKeyEnv]: key };

    service.busy = true;
    service.state.status = "starting";
    service.state.model = startArgs.model;
    service.state.apiKeyRemembered = key !== null;
    service.state.lastError = null;
    service.state.lastExitCode = null;
    service.readyConfirmed = false;
    service.startRequestedAt = Date.now();
    service.exited = false;
    service.stopRequested = false;
    this.publish(service);

    try {
      const result = await this.supervisor.startUnit({
        unit: service.config.unit,
        command: service.config.start.command,
        args: startArgs.args,
        cwd: service.config.start.cwd,
        env: service.config.start.env,
        secretEnv,
        logPath: service.state.logPath,
        killSignal: service.config.stop.signal,
        timeoutStopSec: service.config.stop.graceSeconds,
        onExit: (exit) => this.handleSupervisorExit(service, exit),
      });

      service.busy = false;
      if (!result.ok) {
        service.state.status = "failed";
        service.state.lastError = result.error;
        service.state.startedAt = null;
        service.state.managedBy = null;
        service.state.health = null;
        this.publish(service);
        return { service: { ...service.state }, message: `start failed: ${result.error}` };
      }

      service.startedByUs = true;
      service.state.managedBy = "rc";
      if (!service.exited) {
        service.supervisor = result.supervisor;
      }
      /* Only a start that actually spawned something earns a stored key: the value
         lives in the database so the next start after a server restart finds it. */
      if (key !== null && service.config.apiKeyEnv !== null) {
        this.keys.set(id, service.config.apiKeyEnv, key);
      }
      await this.refresh(id);
      return { service: { ...service.state }, message: "start requested" };
    } catch (error) {
      service.busy = false;
      service.state.status = "failed";
      service.state.lastError = String(error);
      this.publish(service);
      return { service: { ...service.state }, message: `start failed: ${String(error)}` };
    }
  }

  /**
   * Called from the systemd-run exit event, which is attached before the spawn
   * is awaited so even instantly-exiting commands are reported.
   */
  private handleSupervisorExit(service: ManagedService, exit: ServiceExit): void {
    service.exited = true;
    service.supervisor = null;
    const exitCode = exit.signal === null ? (exit.code ?? -1) : null;
    service.state.lastExitCode = exitCode;
    service.state.pid = null;
    service.state.startedAt = null;
    service.state.uptimeSeconds = null;
    service.state.managedBy = null;
    service.state.health = null;
    service.readyConfirmed = false;
    service.startRequestedAt = null;

    if (service.stopRequested) {
      /* A stop we asked for: the command's own status says nothing about a failure.
         Strata's foreground server answers SIGINT with 130 after draining its requests,
         which would otherwise be reported as a crash of a service we just shut down. */
      service.state.status = "stopped";
      service.state.lastError = null;
    } else if (exitCode !== null && exitCode !== 0) {
      service.state.status = "failed";
      service.state.lastError = `process exited with code ${exitCode}`;
    } else {
      service.state.status = "stopped";
      service.state.lastError = null;
    }
    this.publish(service);
  }


  async stop(id: string): Promise<{ service: ServiceState; message: string }> {
    const service = this.services.get(id);
    if (!service) {
      throw new UnknownServiceError(id);
    }
    if (service.busy) {
      return { service: { ...service.state }, message: "operation already in progress" };
    }

    if (!(await this.supervisor.isActive(service.config.unit))) {
      const externalStop = service.config.externalStop;
      if (externalStop !== undefined) {
        const result = await runCommand(externalStop.command, externalStop.args, 15_000).catch(
          (error: unknown) => ({ code: -1, stdout: "", stderr: String(error) }),
        );
        if (result.code !== 0) {
          service.state.lastError = `external stop command failed: ${result.stderr.trim() || `exit code ${result.code}`}`;
          this.publish(service);
          return { service: { ...service.state }, message: service.state.lastError };
        }
      }
      service.state.status = "stopped";
      service.state.pid = null;
      service.state.startedAt = null;
      service.state.uptimeSeconds = null;
      service.state.managedBy = null;
      service.state.health = null;
      this.publish(service);
      return { service: { ...service.state }, message: "already stopped" };
    }

    service.busy = true;
    service.state.status = "stopping";
    service.stopRequested = true;
    this.publish(service);

    const result = await this.supervisor.stopUnit(service.config.unit, service.config.stop.graceSeconds);
    service.busy = false;

    if (!result.ok) {
      service.state.lastError = result.error;
      this.publish(service);
      return { service: { ...service.state }, message: `stop failed: ${result.error}` };
    }

    await this.refresh(id);
    return { service: { ...service.state }, message: "stop requested" };
  }

  /** Re-reads unit state and service health; safe to call on a timer. */
  async refresh(id: string): Promise<void> {
    const service = this.services.get(id);
    if (!service || service.busy) {
      return;
    }

    const properties = await this.supervisor.unitProperties(service.config.unit);
    if (properties.activeState !== "active") {
      if (service.startedByUs && !service.exited) {
        return;
      }
      if (service.state.status !== "stopped" && service.state.status !== "failed") {
        service.state.status = "stopped";
        service.state.pid = null;
        service.state.startedAt = null;
        service.state.uptimeSeconds = null;
        service.state.managedBy = null;
        service.state.health = null;
        service.readyConfirmed = false;
        this.publish(service);
      }
      return;
    }

    if (service.startedByUs && service.exited) {
      /* The supervisor already reported an exit; that outcome wins over a stale unit snapshot. */
      return;
    }

    if (service.state.startedAt === null) {
      service.state.startedAt = properties.startedAtMs;
    }
    service.state.pid = await this.supervisor.unitPid(service.config.unit);

    const healthConfig = service.config.health;
    if (healthConfig === undefined) {
      service.state.status = "running";
      this.publish(service);
      return;
    }

    const health = await checkHealth(healthConfig);
    service.state.health = health;
    if (health.ok) {
      service.readyConfirmed = true;
      service.state.status = "ready";
    } else {
      const startTimedOut =
        service.startRequestedAt !== null &&
        Date.now() - service.startRequestedAt > healthConfig.readyTimeoutSeconds * 1000;
      service.state.status = service.readyConfirmed || startTimedOut ? "degraded" : "starting";
    }
    this.publish(service);
  }

  async refreshAll(): Promise<void> {
    for (const id of this.services.keys()) {
      await this.refresh(id);
    }
  }
}
