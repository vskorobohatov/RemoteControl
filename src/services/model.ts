import { UnknownModelChoiceError, ApiKeyNotAllowedError } from "./errors.js";
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

/**
 * Composes the key of one start, next to the argv of resolveStartArgs.
 *
 * `requested` is what the browser typed and `previous` is what the last start of this
 * service used; both are optional for the same reason the model selector is - pressing
 * start again should not force the operator to paste the key again. A service that
 * declares no key environment cannot take one at all, so a start that carries a key for
 * it is a refusal rather than a key that would silently go nowhere.
 */
export function resolveStartApiKey(
  serviceId: string,
  apiKeyEnv: string | null,
  requested: string | null,
  previous: string | null,
): string | null {
  if (apiKeyEnv === null) {
    if (requested !== null) {
      throw new ApiKeyNotAllowedError(serviceId);
    }
    return null;
  }

  return requested ?? previous;
}
