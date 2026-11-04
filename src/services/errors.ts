/** Domain-level rejections. The API maps each one to a status code. */

/** Raised when a route names a service that is not in the services file. */
export class UnknownServiceError extends Error {
  public constructor(public readonly serviceId: string) {
    super(`unknown service: ${serviceId}`);
  }
}

/** Raised when a start names a model choice the service does not offer. */
export class UnknownModelChoiceError extends Error {
  public constructor(public readonly serviceId: string, public readonly choice: string) {
    super(`unknown model choice for ${serviceId}: ${choice}`);
  }
}
