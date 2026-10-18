/** Domain-level rejections. The API maps each one to a status code. */

export class DuplicateLoginError extends Error {}

/** Raised when an edit would leave the installation without a single admin. */
export class LastAdminError extends Error {}

/** Raised when an account would delete itself out from under its own session. */
export class SelfDeleteError extends Error {}

export function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string" &&
    (error as { code: string }).code.includes("SQLITE_CONSTRAINT")
  );
}
