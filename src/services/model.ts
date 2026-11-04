import { UnknownModelChoiceError } from "./errors.js";
import type { ServiceModelConfig, ServiceStartConfig } from "./types.js";

export interface StartArgs {
  args: string[];
  model: string | null;
}

/**
 * Composes the argv of one start from the model selector of the service.
 *
 * `requested` is what the caller asked for and `previous` is what the last start of
 * this service used; both are optional because the common case is pressing start
 * again without thinking about the model. The configured default covers a restarted
 * server that has forgotten both.
 *
 * The chosen argv is appended rather than replacing the configured one: the api key
 * and the port the health check dials stay where they are no matter which model runs.
 */
export function resolveStartArgs(
  serviceId: string,
  start: ServiceStartConfig,
  model: ServiceModelConfig | undefined,
  requested: string | null,
  previous: string | null,
): StartArgs {
  if (model === undefined) {
    return { args: [...start.args], model: null };
  }

  const chosen = requested ?? previous ?? model.default;
  const option = model.options.find((entry) => entry.value === chosen);
  if (option === undefined) {
    throw new UnknownModelChoiceError(serviceId, chosen);
  }

  return { args: [...start.args, ...option.args], model: option.value };
}