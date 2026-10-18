import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { loadDotEnv } from "./lib/env.js";
import { DATABASE_FILE_NAME } from "./db/connection.js";
import type { ServiceConfig } from "./services/types.js";

export interface ServerConfig {
  host: string;
  port: number;
  publicUrl: string | null;
}

export interface GpuConfig {
  cardPath: string;
  expectPciDevice: string | null;
  rocmSmiFallback: boolean;
  rocmSmiIntervalMs: number;
}

export interface MetricsConfig {
  sampleIntervalMs: number;
  retentionMinutes: number;
  statusIntervalMs: number;
  cpu: { hwmonLabel: string };
  gpu: GpuConfig;
}

export interface UpdateConfig {
  enabled: boolean;
  remote: string;
  releasePattern: string;
  allowDirty: boolean;
  runInstall: boolean;
  runBuild: boolean;
  restartUnit: string | null;
  fetchTimeoutMs: number;
  autoCheckMinutes: number;
}

export interface AuthConfig {
  /**
   * The shared API token. Kept working from the old single-token setup: scripts, curl
   * and health probes can keep using it as a break-glass admin credential while people
   * log in with accounts.
   */
  apiToken: string;
  sessionTtlMs: number;
}

export interface StorageConfig {
  dataDir: string;
  databasePath: string;
}

export interface AppConfig {
  rootDir: string;
  logDir: string;
  server: ServerConfig;
  auth: AuthConfig;
  storage: StorageConfig;
  metrics: MetricsConfig;
  update: UpdateConfig;
  services: ServiceConfig[];
}

export class ConfigError extends Error {}

const isHttpUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const httpUrl = z.string().refine(isHttpUrl, { message: "must be an http(s) URL" });

const isRegExp = (value: string): boolean => {
  try {
    new RegExp(value);
    return true;
  } catch {
    return false;
  }
};

const SERVER_DEFAULTS = { host: "127.0.0.1", port: 8790 } as const;
const AUTH_DEFAULTS = { token: "", session_ttl_hours: 168 } as const;
const STORAGE_DEFAULTS = { path: "data" } as const;
const GPU_DEFAULTS = { card_path: "", rocm_smi_fallback: true, rocm_smi_interval_ms: 10_000 } as const;
const METRICS_DEFAULTS = {
  sample_interval_ms: 2000,
  retention_minutes: 15,
  status_interval_ms: 5000,
  cpu: { hwmon_label: "k10temp" },
  gpu: GPU_DEFAULTS,
} as const;

const serverSchema = z
  .object({
    host: z.string().min(1).default(SERVER_DEFAULTS.host),
    port: z.number().int().min(1).max(65535).default(SERVER_DEFAULTS.port),
    public_url: z.string().optional(),
  })
  .default(SERVER_DEFAULTS);

const authSchema = z
  .object({
    /* Kept from the single-token version; auth.api_token overrides it when present. */
    token: z.string().default(AUTH_DEFAULTS.token),
    api_token: z.string().optional(),
    session_ttl_hours: z.number().int().min(1).max(8760).default(AUTH_DEFAULTS.session_ttl_hours),
  })
  .default(AUTH_DEFAULTS);

const storageSchema = z
  .object({ path: z.string().min(1).default(STORAGE_DEFAULTS.path) })
  .default(STORAGE_DEFAULTS);

const gpuSchema = z
  .object({
    card_path: z.string().default(GPU_DEFAULTS.card_path),
    expect_pci_device: z.string().optional(),
    rocm_smi_fallback: z.boolean().default(GPU_DEFAULTS.rocm_smi_fallback),
    rocm_smi_interval_ms: z.number().int().min(1000).max(600_000).default(GPU_DEFAULTS.rocm_smi_interval_ms),
  })
  .default(GPU_DEFAULTS);

const metricsSchema = z
  .object({
    sample_interval_ms: z.number().int().min(250).max(60_000).default(METRICS_DEFAULTS.sample_interval_ms),
    retention_minutes: z.number().int().min(1).max(240).default(METRICS_DEFAULTS.retention_minutes),
    status_interval_ms: z.number().int().min(1000).max(60_000).default(METRICS_DEFAULTS.status_interval_ms),
    cpu: z
      .object({ hwmon_label: z.string().min(1).default(METRICS_DEFAULTS.cpu.hwmon_label) })
      .default(METRICS_DEFAULTS.cpu),
    gpu: gpuSchema,
  })
  .default(METRICS_DEFAULTS);

const UPDATE_DEFAULTS = {
  enabled: true,
  remote: "origin",
  release_pattern: "^release_(\\d+\\.\\d+(?:\\.\\d+)?)$",
  allow_dirty: false,
  run_install: true,
  run_build: true,
  restart_unit: "",
  fetch_timeout_ms: 30_000,
  auto_check_minutes: 0,
} as const;

const updateSchema = z
  .object({
    enabled: z.boolean().default(UPDATE_DEFAULTS.enabled),
    remote: z.string().min(1).max(64).default(UPDATE_DEFAULTS.remote),
    release_pattern: z
      .string()
      .min(3)
      .refine(isRegExp, { message: "must be a valid regular expression" })
      .default(UPDATE_DEFAULTS.release_pattern),
    allow_dirty: z.boolean().default(UPDATE_DEFAULTS.allow_dirty),
    run_install: z.boolean().default(UPDATE_DEFAULTS.run_install),
    run_build: z.boolean().default(UPDATE_DEFAULTS.run_build),
    restart_unit: z.string().max(128).default(UPDATE_DEFAULTS.restart_unit),
    fetch_timeout_ms: z.number().int().min(1_000).max(300_000).default(UPDATE_DEFAULTS.fetch_timeout_ms),
    auto_check_minutes: z.number().int().min(0).max(1_440).default(UPDATE_DEFAULTS.auto_check_minutes),
  })
  .default(UPDATE_DEFAULTS);

const appConfigSchema = z.object({
  server: serverSchema,
  auth: authSchema,
  storage: storageSchema,
  metrics: metricsSchema,
  update: updateSchema,
  services_file: z.string().min(1).default("config/services.yaml"),
});

const serviceSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/, "id must be lowercase letters, digits or dashes"),
  name: z.string().min(1),
  description: z.string().default(""),
  unit: z.string().regex(/^[A-Za-z0-9_.:@-]{1,64}$/).optional(),
  start: z.object({
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    cwd: z.string().optional(),
    env: z.record(z.string(), z.string()).default({}),
  }),
  stop: z
    .object({
      signal: z.enum(["SIGINT", "SIGTERM", "SIGHUP"]).default("SIGINT"),
      grace_seconds: z.number().int().min(1).max(900).default(60),
    })
    .default({ signal: "SIGINT", grace_seconds: 60 }),
  health: z
    .object({
      url: httpUrl,
      ready_timeout_seconds: z.number().int().min(5).max(3600).default(120),
    })
    .optional(),
  external_stop_command: z.string().min(1).optional(),
});

const servicesFileSchema = z.object({ services: z.array(serviceSchema).min(0) });

export function expandEnvRefs(value: string, source: string): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
    const resolved = process.env[name];
    if (resolved === undefined) {
      throw new ConfigError(`${source}: environment variable ${name} is not set`);
    }
    return resolved;
  });
}

function readYamlFile(filePath: string): unknown {
  if (!existsSync(filePath)) {
    throw new ConfigError(`config file not found: ${filePath}`);
  }

  try {
    return parseYaml(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new ConfigError(`failed to parse ${filePath}: ${String(error)}`);
  }
}

function mapService(raw: z.infer<typeof serviceSchema>): ServiceConfig {
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description,
    unit: raw.unit ?? `rc-${raw.id}`,
    start: {
      command: expandEnvRefs(raw.start.command, `service ${raw.id}.start.command`),
      args: raw.start.args.map((arg) => expandEnvRefs(arg, `service ${raw.id}.start.args`)),
      cwd: raw.start.cwd ? expandEnvRefs(raw.start.cwd, `service ${raw.id}.start.cwd`) : undefined,
      env: Object.fromEntries(
        Object.entries(raw.start.env).map(([key, value]) => [
          key,
          expandEnvRefs(value, `service ${raw.id}.start.env.${key}`),
        ]),
      ),
    },
    stop: { signal: raw.stop.signal, graceSeconds: raw.stop.grace_seconds },
    health: raw.health ? { url: raw.health.url, readyTimeoutSeconds: raw.health.ready_timeout_seconds } : undefined,
    externalStopCommand: raw.external_stop_command
      ? expandEnvRefs(raw.external_stop_command, `service ${raw.id}.external_stop_command`)
      : undefined,
  };
}

export function loadConfig(rootDir: string): AppConfig {
  loadDotEnv(path.join(rootDir, ".env"));

  const configPath = path.join(rootDir, "config", "config.yaml");
  const parsedConfig = appConfigSchema.safeParse(readYamlFile(configPath));
  if (!parsedConfig.success) {
    throw new ConfigError(`${configPath}: ${formatIssues(parsedConfig.error)}`);
  }
  const cfg = parsedConfig.data;

  const servicesPath = path.resolve(rootDir, cfg.services_file);
  const parsedServices = servicesFileSchema.safeParse(readYamlFile(servicesPath));
  if (!parsedServices.success) {
    throw new ConfigError(`${servicesPath}: ${formatIssues(parsedServices.error)}`);
  }

  const services = parsedServices.data.services.map(mapService);
  const ids = services.map((service) => service.id);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (duplicates.length > 0) {
    throw new ConfigError(`${servicesPath}: duplicate service ids: ${duplicates.join(", ")}`);
  }

  const dataDir = path.resolve(rootDir, cfg.storage.path);

  return {
    rootDir,
    logDir: path.join(rootDir, "logs"),
    server: {
      host: cfg.server.host,
      port: cfg.server.port,
      publicUrl: cfg.server.public_url ?? null,
    },
    auth: {
      apiToken: expandEnvRefs(cfg.auth.api_token ?? cfg.auth.token, "auth.api_token"),
      sessionTtlMs: cfg.auth.session_ttl_hours * 3_600_000,
    },
    storage: {
      dataDir,
      databasePath: path.join(dataDir, DATABASE_FILE_NAME),
    },
    metrics: {
      sampleIntervalMs: cfg.metrics.sample_interval_ms,
      retentionMinutes: cfg.metrics.retention_minutes,
      statusIntervalMs: cfg.metrics.status_interval_ms,
      cpu: { hwmonLabel: cfg.metrics.cpu.hwmon_label },
      gpu: {
        cardPath: cfg.metrics.gpu.card_path,
        expectPciDevice: cfg.metrics.gpu.expect_pci_device ?? null,
        rocmSmiFallback: cfg.metrics.gpu.rocm_smi_fallback,
        rocmSmiIntervalMs: cfg.metrics.gpu.rocm_smi_interval_ms,
      },
    },
    update: {
      enabled: cfg.update.enabled,
      remote: cfg.update.remote,
      releasePattern: cfg.update.release_pattern,
      allowDirty: cfg.update.allow_dirty,
      runInstall: cfg.update.run_install,
      runBuild: cfg.update.run_build,
      restartUnit: cfg.update.restart_unit.length > 0 ? cfg.update.restart_unit : null,
      fetchTimeoutMs: cfg.update.fetch_timeout_ms,
      autoCheckMinutes: cfg.update.auto_check_minutes,
    },
    services,
  };
}

function formatIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
}
