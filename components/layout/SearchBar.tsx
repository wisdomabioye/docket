"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactElement } from "react";
import { Icon } from "@/components/ui/Icon";
import { trpc } from "@/lib/trpc/react";
import { APP_ROUTES } from "@/config";

/**
 * Stage 11 W5 — global search bar mounted in the AttorneyTopbar.
 *
 * Behaviour matrix:
 *   - Outer chrome matches `Docket-Meridian-UI/hifi/app.css .topbar
 *     .search` (280px × 30px, white bg, mono `kbd`) so swapping
 *     `SearchStub` → `SearchBar` doesn't reflow the topbar grid.
 *   - 250ms debounce on the input → `trpc.search.global.useQuery`,
 *     gated by `enabled: q.length >= 2` so single-character noise
 *     never reaches the server.
 *   - Dropdown anchors absolutely below the input; opens on focus +
 *     non-empty query, closes on Esc / click-outside / nav.
 *   - Keyboard: Cmd+K (mac) / Ctrl+K (win/linux) focuses the input
 *     site-wide; ↑/↓ moves the active item; Enter navigates; Esc
 *     closes. Mouse hover also updates the active item so click +
 *     keyboard share one source of truth.
 *   - Hits navigate to `/case/[id]` (case) or
 *     `/case/[caseId]/documents` (document — no per-doc detail route
 *     yet; logged in open_issues for a follow-up anchor).
 *
 * Accessibility: input + listbox follow the WAI-ARIA combobox pattern
 * (input owns `role="combobox"`, dropdown owns `role="listbox"`,
 * items `role="option"` with `aria-selected`). Active descendant
 * driven by id, not focus, so the input keeps focus during navigation.
 */

const DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

type CaseHit = {
  id: string;
  beneficiaryName: string;
  visaType: string;
  status: string;
};
type DocumentHit = {
  id: string;
  caseId: string;
  filename: string;
  snippet: string;
};

type FlatHit =
  | { kind: "case"; data: CaseHit }
  | { kind: "document"; data: DocumentHit };

export function SearchBar(): ReactElement {
  const router = useRouter();
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [rawQuery, setRawQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  // `activeIndexRaw` advances per arrow-key press; the clamped
  // `activeIndex` below keeps it in bounds when `flatHits` shrinks
  // (typing a more specific query → fewer results). No effect-driven
  // reset, no ref-reads during render — the clamp is pure.
  const [activeIndexRaw, setActiveIndex] = useState(0);

  // Debounce the raw input → committed query. The query hook is only
  // enabled at >=2 chars, so a single char never reaches `useQuery`.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(rawQuery.trim()), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [rawQuery]);

  const enabled = debouncedQuery.length >= MIN_QUERY_LENGTH;
  const query = trpc.search.global.useQuery(
    { q: debouncedQuery },
    {
      enabled,
      // Topbar autocomplete: short fresh window so a stale cache
      // doesn't show out-of-date case statuses, but long enough to
      // dedupe rapid focus/blur within the same session.
      staleTime: 30_000,
    },
  );

  // Flatten + memoize so keyboard nav works against a single index
  // space across both groups. Order matches the dropdown's render
  // order (cases first, documents second).
  const flatHits = useMemo<FlatHit[]>(() => {
    const data = query.data;
    if (!data) return [];
    const out: FlatHit[] = [];
    for (const c of data.cases) out.push({ kind: "case", data: c });
    for (const d of data.documents) out.push({ kind: "document", data: d });
    return out;
  }, [query.data]);

  // Clamp the raw index so a stale highlight (results just shrunk)
  // can never point past the new array. Pure derivation in render —
  // no useEffect cascade, no ref-during-render footgun. The trade-off
  // vs "reset to 0 on results change": the highlight stays at the
  // numerically-same row, which can mean a different hit when the
  // user types a more specific query. In practice the user is about
  // to ↓ or Enter immediately, so visible drift is sub-perceptual.
  const activeIndex =
    flatHits.length === 0
      ? 0
      : Math.min(activeIndexRaw, flatHits.length - 1);

  const showDropdown = isOpen && enabled;
  const hasResults = flatHits.length > 0;
  const isLoading = enabled && query.isFetching;
  const showEmptyState = enabled && !query.isFetching && !hasResults;

  const navigate = useCallback(
    (hit: FlatHit) => {
      const href =
        hit.kind === "case"
          ? APP_ROUTES.case(hit.data.id)
          : APP_ROUTES.caseDocuments(hit.data.caseId);
      // Clear local state BEFORE navigation so the dropdown isn't
      // briefly visible on the destination page during route transition.
      setRawQuery("");
      setDebouncedQuery("");
      setIsOpen(false);
      router.push(href);
    },
    [router],
  );

  // Cmd+K / Ctrl+K — site-wide focus shortcut. Bound on `window`
  // because the topbar isn't always the focus owner. `e.metaKey` for
  // mac, `e.ctrlKey` for everything else; never both (most cross-
  // platform shortcut libraries use this exact pattern).
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const isCmdK =
        (e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K");
      if (!isCmdK) return;
      // Only intercept when our input exists in the DOM. Defensive
      // check — `inputRef.current` is null between SSR + hydration on
      // a brand-new page nav, but `useEffect` only runs client-side.
      if (!inputRef.current) return;
      e.preventDefault();
      inputRef.current.focus();
      inputRef.current.select();
      setIsOpen(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Click-outside closes the dropdown without losing the typed query
  // (so the user can re-focus to resume).
  useEffect(() => {
    function onPointer(e: PointerEvent): void {
      if (!isOpen) return;
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (containerRef.current?.contains(target)) return;
      setIsOpen(false);
    }
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, [isOpen]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
      // Don't clear the query on Esc — common pattern is "close the
      // dropdown but keep what I typed" so the user can edit & retry.
      return;
    }
    if (!showDropdown || !hasResults) return;
    // Use the CLAMPED `activeIndex` (not the setter-callback's stale
    // `activeIndexRaw`): when results shrunk on a previous render,
    // the raw value is past the new array end and a `(raw + 1) %
    // length` lands on a stale row, making the first ↓ press appear
    // as a no-op. The closure's `activeIndex` already accounts for
    // clamping, so direct math is correct.
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((activeIndex + 1) % flatHits.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((activeIndex - 1 + flatHits.length) % flatHits.length);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const hit = flatHits[activeIndex];
      if (hit) navigate(hit);
    }
  }

  return (
    <div
      ref={containerRef}
      className="relative"
      // Match `.topbar .search` mockup width so the topbar grid stays
      // pixel-stable when SearchStub → SearchBar swaps in. Mockup:
      // width 280px, height 30px.
      style={{ width: 280 }}
    >
      <div
        className="flex h-[30px] w-full items-center gap-2 rounded-sm border px-2.5 text-xs"
        style={{
          background: "var(--white)",
          borderColor: "var(--border)",
          color: "var(--ink-muted)",
        }}
      >
        <Icon name="search" size={12} />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            showDropdown && hasResults ? `${listboxId}-${activeIndex}` : undefined
          }
          placeholder="Search cases, clients, documents…"
          className="flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--ink-muted)]"
          style={{ color: "var(--ink)" }}
          value={rawQuery}
          onChange={(e) => {
            setRawQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          // Form submit is a footgun in topbars (the bar isn't in a
          // <form>, but some browsers fire `Enter` as submit anyway).
          // We handle Enter explicitly above.
          autoComplete="off"
          spellCheck={false}
        />
        <kbd
          className="rounded-sm px-1.5 py-px text-[10px]"
          style={{
            background: "var(--surface-sunken)",
            color: "var(--ink-muted)",
            fontFamily: "var(--font-mono), ui-monospace, monospace",
          }}
        >
          ⌘K
        </kbd>
      </div>

      {showDropdown ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Search results"
          className="absolute right-0 left-0 z-20 mt-1 max-h-[420px] overflow-auto rounded-sm border shadow-lg"
          style={{
            background: "var(--white)",
            borderColor: "var(--border)",
            boxShadow: "var(--shadow-md)",
          }}
        >
          {isLoading && !hasResults ? (
            <div
              className="px-3 py-3 text-[11px]"
              style={{ color: "var(--ink-muted)" }}
            >
              Searching…
            </div>
          ) : null}

          {showEmptyState ? (
            <div
              className="px-3 py-3 text-[11px]"
              style={{ color: "var(--ink-muted)" }}
            >
              No results for &ldquo;{debouncedQuery}&rdquo;
            </div>
          ) : null}

          {hasResults ? (
            <ResultGroups
              listboxId={listboxId}
              hits={flatHits}
              activeIndex={activeIndex}
              onHover={setActiveIndex}
              onSelect={navigate}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ResultGroups(props: {
  listboxId: string;
  hits: ReadonlyArray<FlatHit>;
  activeIndex: number;
  onHover: (i: number) => void;
  onSelect: (hit: FlatHit) => void;
}): ReactElement {
  // Compute group boundaries against the flat array so hover/key
  // indices stay in one number space.
  const cases: Array<{ index: number; data: CaseHit }> = [];
  const docs: Array<{ index: number; data: DocumentHit }> = [];
  props.hits.forEach((h, index) => {
    if (h.kind === "case") cases.push({ index, data: h.data });
    else docs.push({ index, data: h.data });
  });

  return (
    <>
      {cases.length > 0 ? (
        <div className="py-1">
          <GroupHeader>Cases</GroupHeader>
          {cases.map(({ index, data }) => (
            <CaseRow
              key={`case-${data.id}`}
              id={`${props.listboxId}-${index}`}
              hit={data}
              active={props.activeIndex === index}
              onHover={() => props.onHover(index)}
              onClick={() => props.onSelect({ kind: "case", data })}
            />
          ))}
        </div>
      ) : null}
      {docs.length > 0 ? (
        <div
          className="py-1"
          style={{ borderTop: cases.length > 0 ? "1px solid var(--border)" : undefined }}
        >
          <GroupHeader>Documents</GroupHeader>
          {docs.map(({ index, data }) => (
            <DocumentRow
              key={`doc-${data.id}`}
              id={`${props.listboxId}-${index}`}
              hit={data}
              active={props.activeIndex === index}
              onHover={() => props.onHover(index)}
              onClick={() => props.onSelect({ kind: "document", data })}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}

function GroupHeader(props: { children: string }): ReactElement {
  return (
    <div
      className="px-3 py-1 text-[10px] uppercase tracking-wider"
      style={{
        color: "var(--ink-muted)",
        fontFamily: "var(--font-mono), ui-monospace, monospace",
      }}
    >
      {props.children}
    </div>
  );
}

type RowProps<Hit> = {
  id: string;
  hit: Hit;
  active: boolean;
  onHover: () => void;
  onClick: () => void;
};

function CaseRow(props: RowProps<CaseHit>): ReactElement {
  return (
    <button
      id={props.id}
      role="option"
      type="button"
      aria-selected={props.active}
      // `onMouseDown` (not `onClick`) so the dropdown click commits
      // BEFORE the input's blur tears the dropdown down — otherwise
      // pointerdown's blur path fires first and the click never lands.
      onMouseDown={(e) => {
        e.preventDefault();
        props.onClick();
      }}
      onMouseEnter={props.onHover}
      className="block w-full px-3 py-1.5 text-left text-xs"
      style={{
        background: props.active ? "var(--surface-sunken)" : "transparent",
        color: "var(--ink)",
      }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate font-medium">{props.hit.beneficiaryName}</span>
        <span
          className="text-[10px] whitespace-nowrap"
          style={{
            color: "var(--ink-muted)",
            fontFamily: "var(--font-mono), ui-monospace, monospace",
          }}
        >
          {props.hit.visaType} · {props.hit.status}
        </span>
      </div>
    </button>
  );
}

function DocumentRow(props: RowProps<DocumentHit>): ReactElement {
  return (
    <button
      id={props.id}
      role="option"
      type="button"
      aria-selected={props.active}
      onMouseDown={(e) => {
        e.preventDefault();
        props.onClick();
      }}
      onMouseEnter={props.onHover}
      className="block w-full px-3 py-1.5 text-left text-xs"
      style={{
        background: props.active ? "var(--surface-sunken)" : "transparent",
        color: "var(--ink)",
      }}
    >
      <div className="truncate font-medium">{props.hit.filename}</div>
      {props.hit.snippet && props.hit.snippet !== props.hit.filename ? (
        <div
          className="truncate text-[11px]"
          style={{ color: "var(--ink-muted)" }}
        >
          {props.hit.snippet}
        </div>
      ) : null}
    </button>
  );
}
