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

export interface ServiceConfig {
  id: string;
  name: string;
  description: string;
  unit: string;
  start: ServiceStartConfig;
  stop: ServiceStopConfig;
  health?: ServiceHealthConfig;
  externalStopCommand?: string;
}
