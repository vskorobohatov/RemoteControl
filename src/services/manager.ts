import type { ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config.js";
import type { ServiceConfig } from "./types.js";
import { EventBus } from "../lib/bus.js";
import { runCommand } from "../lib/systemctl.js";
import { checkHealth } from "./health.js";
import { SystemdSupervisor } from "./systemd.js";
import type { ServiceExit } from "./systemd.js";
import type { ServiceState } from "../types.js";

export interface ManagedService {
  config: ServiceConfig;
  state: ServiceState;
  supervisor: ChildProcess | null;
  startedByUs: boolean;
  exited: boolean;
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
    },
    supervisor: null,
    startedByUs: false,
    exited: false,
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
  ) {
    mkdirSync(this.config.logDir, { recursive: true });
    for (const serviceConfig of this.config.services) {
      this.services.set(serviceConfig.id, createManaged(this.config, serviceConfig));
    }
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


  async start(id: string): Promise<{ service: ServiceState; message: string }> {
    const service = this.services.get(id);
    if (!service) {
      throw new Error(`unknown service: ${id}`);
    }
    if (service.busy) {
      return { service: { ...service.state }, message: "operation already in progress" };
    }

    if (await this.supervisor.isActive(service.config.unit)) {
      await this.refresh(id);
      return { service: { ...service.state }, message: "already running" };
    }

    service.busy = true;
    service.state.status = "starting";
    service.state.lastError = null;
    service.state.lastExitCode = null;
    service.readyConfirmed = false;
    service.startRequestedAt = Date.now();
    service.exited = false;
    this.publish(service);

    try {
      const result = await this.supervisor.startUnit({
        unit: service.config.unit,
        command: service.config.start.command,
        args: service.config.start.args,
        cwd: service.config.start.cwd,
        env: service.config.start.env,
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

    if (exitCode !== null && exitCode !== 0) {
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
      throw new Error(`unknown service: ${id}`);
    }
    if (service.busy) {
      return { service: { ...service.state }, message: "operation already in progress" };
    }

    if (!(await this.supervisor.isActive(service.config.unit))) {
      if (service.config.externalStopCommand !== undefined) {
        const result = await runCommand("sh", ["-c", service.config.externalStopCommand], 15_000).catch(
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
