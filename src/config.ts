import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { loadDotEnv } from "./lib/env.js";
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

export interface AppConfig {
  rootDir: string;
  logDir: string;
  server: ServerConfig;
  authToken: string;
  metrics: MetricsConfig;
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

const SERVER_DEFAULTS = { host: "127.0.0.1", port: 8790 } as const;
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

const authSchema = z.object({ token: z.string().default("") });

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

const appConfigSchema = z.object({
  server: serverSchema,
  auth: authSchema,
  metrics: metricsSchema,
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

  return {
    rootDir,
    logDir: path.join(rootDir, "logs"),
    server: {
      host: cfg.server.host,
      port: cfg.server.port,
      publicUrl: cfg.server.public_url ?? null,
    },
    authToken: expandEnvRefs(cfg.auth.token, "auth.token"),
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
    services,
  };
}

function formatIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
}
