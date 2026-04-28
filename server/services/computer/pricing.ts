import "server-only";

/**
 * Sonar pricing + token estimation. Single source of truth shared by
 * `MockComputerClient` (so dev cost ledger reads identically to prod)
 * and `SonarClient` (fallback path when the API doesn't return a
 * `usage.cost.total_cost` value).
 *
 * Rates are sonar-pro per Perplexity's pricing page (Stage 07 plan):
 *   - $3 per 1M input tokens
 *   - $15 per 1M output tokens
 *
 * If Perplexity adjusts rates, update this file ONLY — both clients
 * pick up the change. Out-of-date pricing manifests as wrong cost
 * ledger entries; admins notice when the per-case spend doesn't add up.
 */

export const PRICE_INPUT_PER_M_TOKENS_USD_CENTS = 300; // $3.00
export const PRICE_OUTPUT_PER_M_TOKENS_USD_CENTS = 1500; // $15.00

/**
 * Estimate USD cents for a given prompt/completion token pair using
 * sonar-pro rates. Returns `>= 1` so a real call never records 0 cents
 * — the cost ledger's "no spend" semantic is reserved for explicit
 * `compute_credit` entries (Stage 10+).
 */
export function costForTokens(
  promptTokens: number,
  completionTokens: number,
): number {
  const cents = Math.ceil(
    (promptTokens * PRICE_INPUT_PER_M_TOKENS_USD_CENTS +
      completionTokens * PRICE_OUTPUT_PER_M_TOKENS_USD_CENTS) /
      1_000_000,
  );
  return Math.max(1, cents);
}

/**
 * Pre-flight token estimate. Heuristic `Math.ceil(length / 4)` — off by
 * 10–25% vs. real BPE but cheap and dependency-free. Used by:
 *   - `MockComputerClient` to fabricate a realistic usage shape
 *   - `SonarClient` when the wire response omits `usage.cost.total_cost`
 *   - Future context-window pre-flight (open_issues #24)
 *
 * Real `tiktoken` upgrade is open_issues territory — only worth the
 * dep when context-window failures actually appear.
 */
export function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}
