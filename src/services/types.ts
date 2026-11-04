export interface ServiceStartConfig {
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
}

export interface ServiceStopConfig {
  signal: "SIGINT" | "SIGTERM" | "SIGHUP";
  graceSeconds: number;
}

export interface ServiceHealthConfig {
  url: string;
  readyTimeoutSeconds: number;
}

/** Run directly as argv, never through a shell, so a service id cannot become shell syntax. */
export interface ServiceExternalStopConfig {
  command: string;
  args: string[];
}

/**
 * One option of a service's model selector. The argv lives here rather than in the
 * option value because a model is only meaningful together with the quantisation
 * family it was built for (`--family coder --model IQ1_M` is a different model than
 * `--family qwen --model IQ1_M`).
 */
export interface ServiceModelOption {
  value: string;
  label: string;
  args: string[];
}

export interface ServiceModelConfig {
  default: string;
  options: ServiceModelOption[];
}

export interface ServiceConfig {
  id: string;
  name: string;
  description: string;
  unit: string;
  start: ServiceStartConfig;
  stop: ServiceStopConfig;
  health?: ServiceHealthConfig;
  externalStop?: ServiceExternalStopConfig;
  model?: ServiceModelConfig;
}
