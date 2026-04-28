/**
 * URL-state pagination helper for admin list pages.
 *
 * The model: every paginated listing uses **keyset cursors** (a
 * `(createdAt, id)` pair) instead of offset/limit. To support a
 * back-button without an extra "reverse-sort" round-trip, pages carry a
 * **back-stack** of prior cursors in the URL. Forward = push the cursor
 * we're on. Back = pop the top of the stack. Page-1 = empty stack +
 * undefined cursor.
 *
 * URL shape (all params optional):
 *   ?cursor_at=<iso>&cursor_id=<uuid>&stack=<encoded-stack>
 *
 * `stack` encoding: comma-separated entries, each `<isoTs>|<uuid>`.
 * Capped at MAX_STACK so the URL stays under typical proxy/CDN limits.
 */

export type Cursor = { createdAt: string; id: string };

export type PaginationParams = {
  cursor: Cursor | undefined;
  stack: readonly Cursor[];
};

const MAX_STACK = 40;

/** Parse cursor + back-stack from URL search params. Tolerates missing
 *  pieces (defaults to page 1) and silently drops malformed stack
 *  entries — bad URL state shouldn't blow up the page. */
export function parsePaginationParams(searchParams: {
  cursor_at?: string | undefined;
  cursor_id?: string | undefined;
  stack?: string | undefined;
}): PaginationParams {
  const cursor =
    searchParams.cursor_at && searchParams.cursor_id
      ? { createdAt: searchParams.cursor_at, id: searchParams.cursor_id }
      : undefined;

  const stack: Cursor[] = [];
  if (searchParams.stack) {
    for (const entry of searchParams.stack.split(",")) {
      const [createdAt, id] = entry.split("|");
      if (createdAt && id) stack.push({ createdAt, id });
      if (stack.length >= MAX_STACK) break;
    }
  }

  return { cursor, stack };
}

function encodeStack(stack: readonly Cursor[]): string {
  return stack.map((c) => `${c.createdAt}|${c.id}`).join(",");
}

/** Build a URL for the next page. Pushes the current cursor onto the
 *  back-stack so the resulting page can offer a Prev link back here. */
export function buildNextHref(
  base: string,
  current: PaginationParams,
  next: Cursor,
  extras: Readonly<Record<string, string | undefined>> = {},
): string {
  const newStack = current.cursor
    ? [...current.stack, current.cursor].slice(-MAX_STACK)
    : current.stack;
  return buildHref(base, {
    cursor_at: next.createdAt,
    cursor_id: next.id,
    stack: newStack.length > 0 ? encodeStack(newStack) : undefined,
    ...extras,
  });
}

/** Build a URL for the previous page. Pops the last entry off the stack
 *  and uses it as the new cursor. If the stack is empty we go back to
 *  page 1 (no cursor params). Returns `undefined` when there's no
 *  previous page (caller renders a disabled Prev). */
export function buildPrevHref(
  base: string,
  current: PaginationParams,
  extras: Readonly<Record<string, string | undefined>> = {},
): string | undefined {
  if (!current.cursor) return undefined; // already on page 1
  const newStack = [...current.stack];
  const popped = newStack.pop();
  return buildHref(base, {
    ...(popped
      ? { cursor_at: popped.createdAt, cursor_id: popped.id }
      : { cursor_at: undefined, cursor_id: undefined }),
    stack: newStack.length > 0 ? encodeStack(newStack) : undefined,
    ...extras,
  });
}

/** Build a URL preserving non-pagination query params while resetting to
 *  page 1. Use when changing a filter chip — drops cursor + stack so the
 *  user lands on the first page of the newly-filtered result set. */
export function buildResetHref(
  base: string,
  extras: Readonly<Record<string, string | undefined>> = {},
): string {
  return buildHref(base, {
    ...extras,
    cursor_at: undefined,
    cursor_id: undefined,
    stack: undefined,
  });
}

/** Format the "Showing X–Y" range string given the page-1-relative
 *  position. Returns `undefined` when there's nothing to show. */
export function formatRange(opts: {
  pageIndex: number;
  pageSize: number;
  itemsOnPage: number;
}): string | undefined {
  if (opts.itemsOnPage === 0) return undefined;
  const start = opts.pageIndex * opts.pageSize + 1;
  const end = opts.pageIndex * opts.pageSize + opts.itemsOnPage;
  return `${start.toLocaleString()}–${end.toLocaleString()}`;
}

function buildHref(
  base: string,
  params: Record<string, string | undefined>,
): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") sp.set(k, v);
  }
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}
