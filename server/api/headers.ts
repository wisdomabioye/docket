import "server-only";

/**
 * Shared request-header helpers. Routers that need the originating
 * client IP or user-agent for `audit_log` / `signed_documents` rows
 * import from here so the parsing rules (XFF first hop, inet
 * validation, UA truncation) live in one place.
 *
 * `readIp` returns `null` rather than throwing when the header is
 * absent or malformed — the DB columns are `inet` and would reject any
 * non-IP value, so a hostile `x-forwarded-for` could otherwise abort
 * the insert.
 */

/** Best-effort client IP from `x-forwarded-for` (first hop) →
 *  `x-real-ip` fallback. Returns null when neither is present or the
 *  candidate is not a valid IPv4 / IPv6 literal. */
export function readIp(headers: Headers): string | null {
  const xff = headers.get("x-forwarded-for");
  const candidate = xff?.split(",")[0]?.trim() ?? headers.get("x-real-ip");
  if (!candidate) return null;
  return isValidIp(candidate) ? candidate : null;
}

/** RFC-5321-ish IPv4 + IPv6 sniff. Strict enough for `inet` casts. */
export function isValidIp(s: string): boolean {
  const v4 =
    /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
  if (v4.test(s)) return true;
  // IPv6: at least one colon, hex+colon chars only. Defer to Postgres
  // for pedantic validation; we just block obvious non-IPs.
  return /^[0-9a-fA-F:]+$/.test(s) && s.includes(":");
}

/** UA capped at 500 chars (legal records don't need exact UA fidelity;
 *  the typed name + IP + signed PDF carry the weight). Returns null
 *  when the header is absent or empty after trim. */
export function readUserAgent(headers: Headers): string | null {
  const raw = headers.get("user-agent")?.trim();
  if (!raw) return null;
  return raw.length > USER_AGENT_MAX_LENGTH
    ? raw.slice(0, USER_AGENT_MAX_LENGTH)
    : raw;
}

const USER_AGENT_MAX_LENGTH = 500;
