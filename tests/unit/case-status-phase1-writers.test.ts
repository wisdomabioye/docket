// @vitest-environment node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static-analysis guard for ADR-006 sub-decisions 1 + 4.
 *
 * Phase 1 deliberately does NOT write `needs_revision` or
 * `package_ready` even though both are reachable in the state machine.
 * The reconciler implementation embodies that rule, but a future
 * contributor could quietly add a `transitionCase({ toStatus:
 * "needs_revision" })` call elsewhere — at which point we'd ship a
 * silent semantic change.
 *
 * This test scans every `.ts` / `.tsx` file under `server/` and `app/`
 * for `toStatus:` literals and asserts neither deferred status
 * appears. When Phase 2 actually wants those statuses, add the
 * approving location(s) to `ALLOW` below — making the change a
 * deliberate, reviewed action rather than a silent regression.
 *
 * The test file itself is excluded; tests CAN reference the deferred
 * statuses (we test they're illegal in Phase 1).
 */

const REPO_ROOT = join(__dirname, "..", "..");
const SCAN_ROOTS = ["server", "app"];
const ALLOW: ReadonlySet<string> = new Set([
  // Empty in Phase 1. Format: "<relative path>:<status>" — e.g. add
  // "server/services/cases/reconcile-status.ts:needs_revision" when
  // Phase 2 lights it up.
]);

const DEFERRED_STATUSES = ["needs_revision", "package_ready"] as const;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "dist") continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(entry)) yield full;
  }
}

describe("Phase 1 writers guard (ADR-006)", () => {
  for (const status of DEFERRED_STATUSES) {
    it(`no production code writes toStatus: "${status}"`, () => {
      // Pattern intentionally permissive on whitespace + quote style:
      //   `toStatus:  "needs_revision"`, `toStatus:'needs_revision'`,
      //   `toStatus: \`needs_revision\``.
      const re = new RegExp(`toStatus\\s*:\\s*["'\`]${status}["'\`]`);
      const offenders: string[] = [];
      for (const root of SCAN_ROOTS) {
        const abs = join(REPO_ROOT, root);
        for (const file of walk(abs)) {
          const rel = relative(REPO_ROOT, file);
          if (rel.includes(`${status}`) && rel.startsWith("tests/")) continue;
          const src = readFileSync(file, "utf8");
          if (re.test(src) && !ALLOW.has(`${rel}:${status}`)) {
            offenders.push(rel);
          }
        }
      }
      expect(offenders).toEqual([]);
    });
  }
});
