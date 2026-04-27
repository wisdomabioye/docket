/**
 * Throw `AppError` for known, handled error states (validation, auth,
 * not-found, business-rule violations). Unknown errors should propagate
 * untouched so they reach Sentry.
 *
 * tRPC routers convert `AppError` to `TRPCError` at the boundary; route
 * handlers map `code` to an HTTP status via `httpStatusForCode`.
 */

export type AppErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL";

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly cause?: unknown;

  constructor(code: AppErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

const HTTP_STATUS: Record<AppErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export function httpStatusForCode(code: AppErrorCode): number {
  return HTTP_STATUS[code];
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
