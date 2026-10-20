/** Domain-level rejections. The API maps each one to a status code. */

/** Raised when a route names a service that is not in the services file. */
export class UnknownServiceError extends Error {
  public constructor(public readonly serviceId: string) {
    super(`unknown service: ${serviceId}`);
  }
}
