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

/**
 * Map an `AppErrorCode` to a tRPC error code. Stays in this file (not
 * `server/api/trpc.ts`) so it can be imported by router files without
 * circular deps.
 *
 * `RATE_LIMITED` → tRPC's `TOO_MANY_REQUESTS`; `INTERNAL` → `INTERNAL_SERVER_ERROR`;
 * everything else maps 1:1.
 */
export function appErrorToTrpcCode(
  code: AppErrorCode,
):
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "TOO_MANY_REQUESTS"
  | "INTERNAL_SERVER_ERROR" {
  switch (code) {
    case "BAD_REQUEST":
      return "BAD_REQUEST";
    case "UNAUTHORIZED":
      return "UNAUTHORIZED";
    case "FORBIDDEN":
      return "FORBIDDEN";
    case "NOT_FOUND":
      return "NOT_FOUND";
    case "CONFLICT":
      return "CONFLICT";
    case "RATE_LIMITED":
      return "TOO_MANY_REQUESTS";
    case "INTERNAL":
      return "INTERNAL_SERVER_ERROR";
  }
}
