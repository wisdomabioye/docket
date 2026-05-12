/**
 * Render-friendly conversion of a tRPC mutation/query error.
 *
 * Without this, components rendering `mutation.error.message` directly
 * end up showing the raw Zod issue list as a JSON-looking string
 * (`[{"code":"too_small","path":["fullName"], ... }]`) because that's
 * what Zod packs into the message when validation fails at the router
 * boundary. The server's `errorFormatter` in `server/api/trpc.ts:43-50`
 * does the right thing — it attaches `data.zodError` (Zod v4
 * `flatten()` output) to the wire shape. The formatter below is the
 * client-side companion: read `data.zodError`, surface human-readable
 * field messages, fall back to `error.message` for non-Zod errors.
 *
 * Accepts `unknown` so it can also handle non-tRPC errors (e.g. fetch
 * failures, thrown strings) without type narrowing at every call site.
 */

type ZodFlattenedError = {
  formErrors?: string[];
  fieldErrors?: Record<string, string[] | undefined>;
};

type TrpcLikeError = {
  message?: string;
  data?: { zodError?: ZodFlattenedError | null } | null;
};

/**
 * Convert any caught value into a single string suitable for an error
 * banner. Multi-field Zod errors join with newlines so the renderer
 * can pre-wrap them; single-message errors stay on one line.
 *
 * Returns `null` when there's truly nothing to show (e.g. `undefined`,
 * a non-Error object with no message) so callers can render `null`
 * banners as nothing — but normal use is "string or fallback".
 */
export function formatTrpcError(err: unknown): string | null {
  if (err === null || err === undefined) return null;

  if (isTrpcLikeError(err)) {
    const zod = err.data?.zodError;
    if (zod) {
      const lines: string[] = [];
      if (zod.fieldErrors) {
        for (const [field, messages] of Object.entries(zod.fieldErrors)) {
          if (!messages || messages.length === 0) continue;
          // First message per field — Zod can emit several issues for
          // one field (e.g. type + too_small); the first is almost
          // always the most informative.
          lines.push(`${humanizeField(field)}: ${messages[0]}`);
        }
      }
      if (zod.formErrors && zod.formErrors.length > 0) {
        for (const m of zod.formErrors) lines.push(m);
      }
      if (lines.length > 0) return lines.join("\n");
    }
    if (typeof err.message === "string" && err.message.length > 0) {
      return err.message;
    }
  }

  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Unexpected error.";
}

function isTrpcLikeError(err: unknown): err is TrpcLikeError {
  return typeof err === "object" && err !== null;
}

/**
 * Turn a camelCase or snake_case field key into a sentence-cased
 * label. Keeps the formatter UI-aware without a per-form mapping —
 * fields the schema already names well render readably. Forms that
 * want bespoke labels pass `error.data.zodError` through their own
 * lookup instead of calling this helper.
 */
function humanizeField(field: string): string {
  const spaced = field
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  if (spaced.length === 0) return field;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}
