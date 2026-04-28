import { describe, expect, it } from "vitest";
import {
  buildNextHref,
  buildPrevHref,
  buildResetHref,
  formatRange,
  parsePaginationParams,
} from "@/lib/keyset-pagination";

/**
 * Pure unit tests for the URL-state pagination helper. The interesting
 * behaviour — back-stack push on Next, pop on Prev, page-1 reset on
 * filter change — is all derivable from inputs without touching the DB,
 * so these stay in `tests/unit/`.
 */

const BASE = "/admin/attorneys";
const C1 = { createdAt: "2026-01-01T00:00:00.000Z", id: "11111111-1111-4111-8111-111111111111" };
const C2 = { createdAt: "2026-01-02T00:00:00.000Z", id: "22222222-2222-4222-8222-222222222222" };
const C3 = { createdAt: "2026-01-03T00:00:00.000Z", id: "33333333-3333-4333-8333-333333333333" };

describe("parsePaginationParams", () => {
  it("returns empty page-1 state when no params present", () => {
    expect(parsePaginationParams({})).toEqual({
      cursor: undefined,
      stack: [],
    });
  });

  it("parses cursor when both halves present", () => {
    const out = parsePaginationParams({
      cursor_at: C1.createdAt,
      cursor_id: C1.id,
    });
    expect(out.cursor).toEqual(C1);
    expect(out.stack).toEqual([]);
  });

  it("ignores partial cursor (only one half present)", () => {
    expect(parsePaginationParams({ cursor_at: C1.createdAt })).toEqual({
      cursor: undefined,
      stack: [],
    });
  });

  it("parses encoded back-stack", () => {
    const stackParam = `${C1.createdAt}|${C1.id},${C2.createdAt}|${C2.id}`;
    const out = parsePaginationParams({ stack: stackParam });
    expect(out.stack).toEqual([C1, C2]);
  });

  it("silently drops malformed stack entries", () => {
    const stackParam = `${C1.createdAt}|${C1.id},garbage,${C2.createdAt}|${C2.id}`;
    const out = parsePaginationParams({ stack: stackParam });
    expect(out.stack).toEqual([C1, C2]);
  });
});

describe("buildNextHref", () => {
  it("encodes the next cursor without a stack on first page transition", () => {
    const href = buildNextHref(BASE, { cursor: undefined, stack: [] }, C1);
    const url = new URL(href, "http://x");
    expect(url.searchParams.get("cursor_at")).toBe(C1.createdAt);
    expect(url.searchParams.get("cursor_id")).toBe(C1.id);
    expect(url.searchParams.get("stack")).toBeNull();
  });

  it("pushes the current cursor onto the stack when navigating forward", () => {
    const href = buildNextHref(BASE, { cursor: C1, stack: [] }, C2);
    const url = new URL(href, "http://x");
    expect(url.searchParams.get("cursor_at")).toBe(C2.createdAt);
    expect(url.searchParams.get("stack")).toBe(`${C1.createdAt}|${C1.id}`);
  });

  it("appends rather than replaces an existing stack", () => {
    const href = buildNextHref(BASE, { cursor: C2, stack: [C1] }, C3);
    const url = new URL(href, "http://x");
    expect(url.searchParams.get("stack")).toBe(
      `${C1.createdAt}|${C1.id},${C2.createdAt}|${C2.id}`,
    );
  });

  it("preserves filter extras", () => {
    const href = buildNextHref(BASE, { cursor: undefined, stack: [] }, C1, {
      status: "active",
    });
    expect(href).toContain("status=active");
  });
});

describe("buildPrevHref", () => {
  it("returns undefined on page 1 (no cursor)", () => {
    expect(
      buildPrevHref(BASE, { cursor: undefined, stack: [] }),
    ).toBeUndefined();
  });

  it("returns base URL when popping back to page 1 (empty stack)", () => {
    const href = buildPrevHref(BASE, { cursor: C1, stack: [] });
    expect(href).toBe(BASE);
  });

  it("pops the top of the stack and uses it as the new cursor", () => {
    const href = buildPrevHref(BASE, { cursor: C2, stack: [C1] });
    const url = new URL(href!, "http://x");
    expect(url.searchParams.get("cursor_at")).toBe(C1.createdAt);
    expect(url.searchParams.get("cursor_id")).toBe(C1.id);
    expect(url.searchParams.get("stack")).toBeNull();
  });

  it("preserves remaining stack entries", () => {
    const href = buildPrevHref(BASE, { cursor: C3, stack: [C1, C2] });
    const url = new URL(href!, "http://x");
    expect(url.searchParams.get("cursor_at")).toBe(C2.createdAt);
    expect(url.searchParams.get("stack")).toBe(`${C1.createdAt}|${C1.id}`);
  });

  it("preserves filter extras across Prev navigation", () => {
    const href = buildPrevHref(
      BASE,
      { cursor: C1, stack: [] },
      { status: "active" },
    );
    expect(href).toBe(`${BASE}?status=active`);
  });

  it("preserves multiple filter extras when popping mid-stack", () => {
    const href = buildPrevHref(
      BASE,
      { cursor: C2, stack: [C1] },
      { status: "active", visa: "O-1A" },
    );
    const url = new URL(href!, "http://x");
    expect(url.searchParams.get("status")).toBe("active");
    expect(url.searchParams.get("visa")).toBe("O-1A");
    expect(url.searchParams.get("cursor_at")).toBe(C1.createdAt);
  });
});

describe("buildResetHref", () => {
  it("drops cursor and stack while keeping filter extras", () => {
    const href = buildResetHref(BASE, { status: "pending" });
    expect(href).toBe(`${BASE}?status=pending`);
  });

  it("returns the base URL when no extras provided", () => {
    expect(buildResetHref(BASE)).toBe(BASE);
  });
});

describe("formatRange", () => {
  it("returns undefined for empty page", () => {
    expect(
      formatRange({ pageIndex: 0, pageSize: 25, itemsOnPage: 0 }),
    ).toBeUndefined();
  });

  it("computes 1-based start/end inclusive of itemsOnPage", () => {
    expect(formatRange({ pageIndex: 0, pageSize: 25, itemsOnPage: 25 })).toBe(
      "1–25",
    );
    expect(formatRange({ pageIndex: 1, pageSize: 25, itemsOnPage: 10 })).toBe(
      "26–35",
    );
  });

  it("formats with locale separators on large numbers", () => {
    expect(
      formatRange({ pageIndex: 40, pageSize: 25, itemsOnPage: 25 }),
    ).toBe("1,001–1,025");
  });
});

describe("round-trip Next → Prev", () => {
  it("Prev after Next lands you back on the original page", () => {
    // Page 1 → Next (using C1 as next cursor) → Page 2.
    const fromPage1 = parsePaginationParams({});
    const nextHref = buildNextHref(BASE, fromPage1, C1);
    const onPage2 = parsePaginationParams(parseSearchParams(nextHref));

    expect(onPage2.cursor).toEqual(C1);

    // From page 2, Prev → back to page 1.
    const prevHref = buildPrevHref(BASE, onPage2);
    expect(prevHref).toBe(BASE);
  });

  it("two Nexts then two Prevs returns to page 1", () => {
    let state = parsePaginationParams({});
    state = parsePaginationParams(parseSearchParams(buildNextHref(BASE, state, C1)));
    state = parsePaginationParams(parseSearchParams(buildNextHref(BASE, state, C2)));
    expect(state.cursor).toEqual(C2);
    expect(state.stack).toEqual([C1]);

    state = parsePaginationParams(parseSearchParams(buildPrevHref(BASE, state)!));
    expect(state.cursor).toEqual(C1);
    expect(state.stack).toEqual([]);

    const back2 = buildPrevHref(BASE, state);
    expect(back2).toBe(BASE);
  });
});

function parseSearchParams(href: string) {
  const url = new URL(href, "http://x");
  return {
    cursor_at: url.searchParams.get("cursor_at") ?? undefined,
    cursor_id: url.searchParams.get("cursor_id") ?? undefined,
    stack: url.searchParams.get("stack") ?? undefined,
  };
}
