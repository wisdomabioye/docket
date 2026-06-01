# Open issues

Tracker for design questions and known gaps. Three sections:

- **Active** — needs decision or action soon (blocks current/next stage)
- **Phase-2 backlog** — known limitations to revisit when scale demands them
- **Resolved** — decisions captured for posterity

When a gap is identified but not fixed in the same response, it goes here.
"Concerns mentioned in chat" are not enough — add an entry.

---

## Active

### #73 — Integration suite occasionally flakes (shared DB across parallel workers)

Date: 2026-06-01.
Observed once during Stage-13 #72 work: a full `pnpm vitest run` reported
`case-router.test.ts > case.archive > a soft-deleted case is hidden from
case.list` failing, but the file passes 36/36 in isolation and the change in
flight (an outputs-page presentational beneficiary-parse) cannot touch
`case.archive`/`case.list`. Vitest runs test FILES in parallel workers against
ONE shared Postgres test DB, so files can intermittently interfere (e.g. rows
from a concurrent file leaking into a `case.list` count/visibility assertion).
Pre-existing, not introduced by #72; low frequency.
**How to apply:** options — (a) run integration tests with a single worker
(`--poolOptions.threads.singleThread` / `fileParallelism: false`) so DB state is
serial; (b) scope each integration file to its own schema/namespace or unique
ids + transactional rollback; (c) accept + retry flaky integration files. Pick
when it recurs or before relying on the suite as a hard CI gate.

### #72 — Stage 13 Track B: remaining mockup-fidelity visual refresh

Date: 2026-06-01.
Stage 13 (lifecycle guidance UX) shipped Track A in full — the next-action
resolver (`lib/case-stage.ts` `deriveCasePrimaryAction` + `server/services/cases/guidance.ts`),
the unified `CaseNextAction` card + `CaseActionBar` header bar + in-progress
auto-refresh, and the editor review queue — plus one Track-B win (build page
reuses `CriteriaCoverageCard`). Progress (2026-06-01):
- DONE Overview: `CaseSummaryCard` (visa·field/country/residence/target-filing +
  recommender·doc·output counts via existing `storageUsage` + `recommender.list`)
  + humanized activity via shared `lib/case-event.ts` `describeCaseEvent` (also
  fixed a pre-existing dashboard humanizer drift). No "All →" — no activity-archive
  page exists (a link would be dead).
- DONE Outputs: `BundleStats` cluster (Outputs/Approved/Awaiting/Criteria — real
  counts). NOT done: output snippets (needs a bounded SQL content preview +
  markdown-strip + structured-type handling) and per-card drafting state (no
  per-output in-progress signal or ETA exists → would be fabrication; the
  "building" message stays).
- DONE Documents: file-type icon, human type label, upload date, status PILLS
  (`Badge` via `lib/document-display.ts`), section summary line, dropzone icon.
- DONE Dashboard urgent due-date color (was already built in `TodayCard`).

- DONE Output snippets: bounded SQL `left(content,300)` preview on
  `getCurrentOutputsForList` → `snippetSource`; `lib/snippet.ts` `toSnippet`
  strips markdown; `OutputCard` renders it (skipped for structured/JSON types).
- DONE Editor "Sections" TOC: `lib/toc.ts` `parseHeadings` + a right-rail list
  in `OutputDetailPanel` that scrolls the rendered doc to the matching `<h*>` by
  text (no ProseMirror id-injection). Placed in the right rail (not the mockup's
  left rail) to avoid a fragile 3-column responsive change — functional parity.

ALL honestly-buildable Track-B items are now DONE. Not built (would be dead
controls / fabrication — need new data, Phase 2):
- Dashboard Today checkbox + done state: `me.todayTasks` returns only OPEN
  actionable items; there is no task-completion flag. A checkbox would persist
  nothing. Needs a completion model (Phase 2).
- Per-output drafting card + ETA: no per-output in-progress signal or ETA exists.
**Explicitly OUT (verified):** numeric readiness score, build output-selection
table + per-output ETA/cost, per-document criterion column, package fees/e-filing/
attestation, dashboard assignee column — fabrication or Phase-2/spec-excluded
(spec §175/§206/§1424). See `build_stages/13_lifecycle_guidance_ux.md`.
**How to apply:** pick a page, match its `Docket-Meridian-UI/hifi/*.html` mockup
using existing `app.css` tokens; data-back every element (no fabrication).

### #70 — Same OCC-race class lives in output editing (`case_outputs.row_revision`)

Date: 2026-05-19.
Fixed the intake wizard's "case was modified (revision N, expected N-1)"
loop by (a) returning the post-trigger `row_revision` from
`case.updateBeneficiary`, (b) replacing the client's `+= 1` guess with a
synced ref, and (c) serializing saves through a single promise chain so
`onSubmit` can drain in-flight + pending writes before firing
`completeIntake`. See `components/case/IntakeWizard.tsx` (`saveQueueRef`)
and `server/api/routers/case.ts:354-373`.
`case_outputs` carries the same `row_revision` trigger
(`migrations/0004_row_revision_trigger.sql:30`) and the output editor
(Tiptap autosave) has the same shape — debounced saves + an OCC token
on a row that other writers (status flips, compute-spend bumps) also
touch. Same race is latent there.
**How to apply:** when the next user reports "output was modified
(revision …)" on the editor, port the same three changes to
`output.update*` mutations + the editor's save flow. Don't preemptively
refactor — wait for the reproducible report.

### #69 — `currentLocation` removal blanks any pre-existing beneficiary blobs

Status: Resolved 2026-06-01.
`BeneficiaryDataSchema` dropped `currentLocation`/`recommendersCount`
and added `currentCountry` + `currentCity`. The schema stays
`.strict()`, so any DB row still carrying a removed key failed
`safeParse` on READ — and both read sites (`intake/page.tsx`,
`notifications/recipient.ts`) silently fell back to `{}`/`null`,
blanking the attorney's intake form and the email case label.

Root cause was one schema doing two opposite jobs: strict is correct
for the WRITE/input boundary (reject unexpected client keys) but
destructive on stored READS (own data with legacy keys).

Fix (no SQL migration needed — production data self-heals):
- Added `StoredBeneficiaryDataSchema = BeneficiaryDataSchema.strip()`
  in `server/db/schema/zod/beneficiary.ts` — same field set, drops
  unknown keys instead of failing. Kills the whole field-removal bug
  class, not just the two known keys.
- Read sites use the tolerant schema; input sites keep `.strict()`.
- `case.updateBeneficiary` parse-strips the existing row before the
  merge, so every save drops dead keys → blobs converge to clean as
  attorneys edit.
Tests: `tests/unit/zod-schemas.test.ts` (strip behavior + value
contracts still enforced), `tests/unit/notifications-recipient.test.ts`
(legacy key still yields the real name), `tests/integration/case-router.test.ts`
(self-heal on save).

### #68 — Sweep status-equality checks + relocate route-scoped status arrays

Status: Resolved 2026-05-13.
- Relocated `NON_ACTIVE_STATUSES` → `INACTIVE_STATUSES` and
  `TODAY_ACTIONABLE_STATUSES` from `server/api/routers/me.ts` →
  `lib/case-status.ts`.
- Promoted the inline SQL tuple `('draft_ready','needs_revision')`
  in `me.dashboardKpis` to `DRAFTS_AWAITING_REVIEW_STATUSES` in
  `lib/case-status.ts`; collapsed the redundant `notInactiveFilter()`
  helper into the generalized `statusTupleSql(...)`.
- Swapped two raw `status !== "intake" && status !== "documents_pending"`
  checks (in `case.updateBeneficiary` and `app/case/[id]/intake/page.tsx`)
  to the existing `canEditIntake(status)` gate.
- Left inline (single-status transition guards, not bucket checks):
  `case.completeIntake` (`status === "intake"` precondition for the
  recommender-count check), `case.markFiled` (`delivered | filed`
  legal-status gate), `case-build.ts` watchdog (`status !== "building"`),
  `admin.unmarkFiledCase` (`status !== "filed"`), `readiness.ts`
  reconciler edges, and `outputs/page.tsx`'s UI "building" predicate
  (two occurrences, same file — not promotable yet).

Original report retained below.

Surfaced 2026-05-13 (raised during #59b review of case-stage centralization).

Three layers of case-status logic exist in the codebase. After
#59b two of them are already well-centralized; the third is the
remaining drift surface.

**Centralized (no action):**
- Status → derived UX state (label, sub, nextAction, progress %)
  → `lib/case-stage.ts::deriveCaseStage` (new this sprint).
- Status → legal transitions → `lib/case-status.ts::TRANSITIONS`.
- Status → buckets → `lib/pipeline.ts::PIPELINE_STATUSES`.
- Status → gate functions (`canEditIntake`, `canUploadInStatus`,
  `canRequestBuild`) → `lib/case-status.ts`.

**Still drifting (the work for this issue):**

1. **Two route-scoped status arrays in `server/api/routers/me.ts`:**
   - `TODAY_ACTIONABLE_STATUSES` (line ~37)
   - `NON_ACTIVE_STATUSES` (line ~34)
   Both are queried by multiple `me.*` procedures. Move to
   `lib/case-status.ts` as named exports so future status additions
   land in one file. No behavior change.

2. **Raw `status === "X"` checks scattered across app/components/
   server.** Run `grep -rn 'status === "' app/ components/ server/`
   and triage each match:
   - If it duplicates an existing gate (`canEditIntake`, etc.), swap
     to the gate.
   - If it's genuinely "status is exactly X, do Y" (e.g. transition
     guards in the router), leave inline.
   - If the same comparison appears in 3+ places without a gate,
     promote it to a new gate in `lib/case-status.ts`.

3. **(Optional)** Audit `data.status === "intake" && status !==
   "documents_pending"` style compound expressions; many are
   reinventing buckets that already exist in `PIPELINE_STATUSES` or
   `BUILDABLE_STATUSES`.

**Out of scope:** a unified "case status registry" with one record
per status carrying every consumer's metadata. That centralization
felt tidy in design but invites bloat — every consumer has different
needs (buckets, transitions, copy, gates, badges). Splitting by
responsibility (current state) is correct; only the route-scoped
arrays + raw-string-equality checks need relocation.

Recommended order: (1) move the two arrays first (mechanical,
low-risk), (2) run the grep sweep, (3) decide per-match.

### #67 — No application-level 500 error page

Status: Resolved 2026-05-13. Segment-scoped error boundaries added at
`app/(app)/error.tsx` and `app/(marketing)/error.tsx` (mirroring the
pre-existing `app/(admin)/error.tsx`). All three render branded
chrome, surface the Next-generated `digest` for support correlation,
and offer a `reset()` retry plus a segment-appropriate exit (dashboard
for app, home for marketing, dashboard for admin). `app/global-error.tsx`
rewritten to use brand tokens via a direct `globals.css` import so the
last-resort fallback (when a segment boundary itself throws) is
visually consistent. Sentry capture remains intact via
`instrumentation.ts::onRequestError` plus an in-boundary
`Sentry.captureException` at the global scope.

Original report retained below.

Surfaced 2026-05-12.

Next.js App Router defaults to a generic browser error page on
uncaught server errors. Docket has `app/global-error.tsx` (the
top-level error boundary) but no scoped 500-style fallback for the
authenticated app shell. Today an attorney who hits an unhandled
exception during a tRPC query sees either the default Next error
chrome or a blank screen, depending on which boundary catches it.

Recommended fix: add `app/(app)/error.tsx` (and verify
`app/global-error.tsx` is wired correctly) using the editorial
Card/EmptyState components so the failure mode matches brand chrome.
Surface the Sentry event id for support correlation; no stack trace
to end-user. Mirror to `app/(admin)/error.tsx` and
`app/(marketing)/error.tsx` so every segment has its own boundary.
Add reset() button hooked to Next's error-boundary contract.

Out of scope: structured error reporting beyond what Sentry already
captures; that's #63's domain.

### #66 — Attorney onboarding form lacks validation; accepts invalid data

Status: Active. Surfaced 2026-05-12.

`app/(app)/onboarding/OnboardingForm.tsx` accepts the attorney's bar
number, bar states, and other profile fields without input
sanitization equivalent to #65's intake validators. Invalid characters
in bar number, free-form symbols in name fields, or impossible bar
state codes pass to the server. Schema at
`server/db/schema/zod/attorney-onboarding.ts` (verify path) likely
mirrors `BeneficiaryDataSchema`'s loose contract.

Recommended fix: apply the same `safeName`/`safeText` validators from
#65 to the onboarding schema. Bar number gets a dedicated validator
(`^[A-Z0-9-]{3,20}$` typical shape — confirm format with founder /
legal). Bar states must come from a closed enum (US state codes plus
territories), not free text. Route mutation errors through
`formatTrpcError` (#63) so server validation messages render cleanly.

Coordinate with #65: both should land in the same commit OR #65 first,
because the validator helpers are shared.

Status: Active. Surfaced 2026-05-12 (attorney UX audit).

`server/db/schema/zod/beneficiary.ts:21-47` validates `fullName`,
`occupation`, `field`, `nationality`, and `currentLocation` with only
`.string().min(1).max(N)`. Angle brackets, backticks, braces, and
control characters all pass — bad for downstream prompt safety and
PDF rendering, and noise for clerks reviewing intake.

Recommended fix: add `lib/validators.ts` exporting two reusable Zod
helpers — `safeName(max)` (Unicode letters + space, hyphen, apostrophe,
period; rejects digits and symbols) and `safeText(max)` (broader: also
allows digits and common punctuation; rejects `<>{}` and control
chars). Apply `safeName` to name/nationality, `safeText` to
occupation/location. Narrative fields (notes, guidance) stay
unrestricted. Schema is the source of truth — RHF resolver gets the
same rules on the client.

Out of scope: deciding Unicode policy for non-Latin scripts. Default
to permissive (`\p{L}` class) unless legal says otherwise.

### #64 — DateInput silently reverts invalid input; year bounds hardcoded to 1900

Status: Active. Surfaced 2026-05-12.

`components/ui/DateInput.tsx` already does the hard work (masked input,
calendar popover via react-day-picker, impossible-date rejection via
JS `Date` round-trip at ~lines 82-88). Two gaps:

1. Invalid blur silently reverts to the last valid value (~line 145).
   No `aria-invalid`, no error surfaced to the parent form.
2. Calendar minYear hardcoded to 1900 (~line 226) regardless of
   semantic. DOB should top out at today; filing dates should floor at
   today.

Recommended fix: (a) expose an `onInvalid?: () => void` callback OR
(preferred) make the component "uncontrolled valid-only" and let RHF's
`fieldState.error` surface the message via the parent — no internal
toast. (b) derive `minYear`/`maxYear` from existing `min`/`max` props
when present; expose explicit props as overrides.

### #63 — tRPC validation errors render as raw JSON to the user

Status: Active. Surfaced 2026-05-12.

`server/api/trpc.ts:41-50` correctly attaches
`zodError: error.cause.flatten()` to the error shape. The bug is on
the client: `NewCaseForm.tsx:60-62` and `IntakeWizard.tsx` render
`mutation.error.message` directly, which for Zod issues is a
JSON-stringified array of issues — users see
`[{"code":"too_small",...}]`.

Recommended fix: add `lib/trpc/format-error.ts` exporting
`formatTrpcError(err)` that prefers `err.data?.zodError?.fieldErrors`
(joins the first message per field as `"Field: message"`), falls back
to `err.message`. Replace every direct `error.message` render with a
call to this helper. Do not change the server formatter — it's
correct; only client rendering is wrong.

Acceptance: submit intake with invalid DOB → banner reads
"Date of birth: Must be a valid date" not raw JSON.

### #62 — IntakeWizard does not gate Next on per-section validation

Status: Active. Surfaced 2026-05-12.

`components/case/IntakeWizard.tsx:550-606` — the Next button calls
`navigateToSection(nextSectionAfter(active))` unconditionally. The
full `BeneficiaryDataSchema` runs only at submit (~line 238). A user
can fill section 1 with junk, click Next, never see an error until
the final submit several steps later.

Recommended fix: define `SECTION_FIELDS: Record<SectionKey,
(keyof BeneficiaryData)[]>` colocated with the section list. In the
Next handler, run `BeneficiaryDataSchema.pick(SECTION_FIELDS[active])
.safeParse(currentValues)`; if it fails, set field errors on the form
state and block navigation. Same map drives the per-section error
badge in the rail (today none).

Pre-req: the wizard currently does manual `useState` field tracking;
this work is cleanest after moving to react-hook-form + zodResolver.
Track that as the parent refactor.

### #61 — IntakeWizard has no Previous button

Status: Active. Surfaced 2026-05-12.

`components/case/IntakeWizard.tsx:550-606` footer renders only the
forward primary button ("Next: …" or "Submit intake →"). There is a
`nextSectionAfter(...)` helper at ~line 626 but no symmetric prev.
Users can click the rail items to jump backward, but the muscle memory
expectation for wizards is forward/back buttons.

Recommended fix: add `prevSectionBefore(key)`. Render a secondary
"← Back: {label}" button on sections 2..N in the footer bar's left
slot. Reuse the existing auto-save-on-navigation pathway. No new
state.

### #60 — RecommenderListEditor hardcodes "three" instead of reading visa config

Status: Active. Surfaced 2026-05-12. Closely related to #50.

`lib/visa-criteria.ts:73` defines optional `minRecommenders`;
`:160` sets O-1A → 3. EB-1A currently omits the field (per
`Adding_New_Visa_Type_Guide.md`). `components/case/RecommenderListEditor.tsx:138`
hardcodes the empty-state subtitle "Add at least three letter-writers
(O-1A minimum)". If/when EB-1A gets `minRecommenders: 5`, this stays
wrong without code changes — exactly the drift #50 also warns about.

Recommended fix: pass `visaType` as a prop into
`RecommenderListEditor`; resolve `minRecommenders` via
`visaCriteriaConfig(visaType)?.minRecommenders`. Drive the empty-state
copy, an "X of Y added" counter, and a "below recommended" chip on
the case overview from this single value. Undefined → neutral copy
("Add letter-writers") and no counter.

Two follow-ups: (a) product decision on EB-1A's `minRecommenders`
(log in `docs/decisions.md`); (b) #50 already calls for un-hardcoding
the `case.completeIntake` server-side message — fold both fixes into
the same commit so message and UI agree.

### #59b — First-run attorneys can't tell what step comes next in a case

Status: Active. Surfaced 2026-05-12 (attorney UX feedback —
"create case, upload documents, all by guessing").

The case lifecycle is deterministic — intake → documents → build →
review → approve → package → file — but the UI today exposes the
sub-pages as a flat sidebar (`AttorneySidebar`) with no explicit
"you are here / do this next" cue. New attorneys create a case and
then bounce between Documents and Build with no signal that intake
is incomplete, that build is blocked on missing required docs, or
that the package can be generated.

Recommended fix (preferred — scales, no copy-decay risk):
- Add a server-derived `caseStage` (and `nextAction`) computed from
  existing state: intake completeness %, required-doc coverage from
  `lib/visa-criteria.ts`, output approval count, package generation,
  `filed_at`. Pure function over the case row + related counts; no
  new persisted column.
- Render a horizontal `CaseStageRail` at the top of every
  `case/[id]/*` page showing the current stage and a primary
  next-action CTA ("Generate package", "Approve 2 remaining outputs",
  etc.). Same value drives the case-card subtitle on the dashboard
  and the empty state for first-time users.
- Don't add a tour library (Driver.js, Shepherd). They become
  maintenance debt as flows change. The stage rail is computed from
  state, so it can't drift.

Bonus: this is also the natural home for the per-section progress
chips that #62 needs in the intake wizard.

Out of scope: re-architecting the sidebar. The stage rail is
additive; the sidebar stays.

### #59 — `cases_admin` RLS policy leaks all cases into attorney-side `case.list`

Status: Resolved 2026-05-13. Every attorney-scoped read on a single
case now application-gates on `caseParticipants` membership via
`server/services/cases/visibility.ts::isUserCaseParticipant` —
covering case.ts (14 procedures), output.ts (9 mutations +
downloadPackage + 3 reads), document.ts (4), recommender.ts (5), and
the join-form gate on case.list. The Cmd+K topbar (`search.global`)
also filters cases + documents by a `case_participants` subquery so
admin sessions don't see other attorneys' surfaces through search.
Regression nets:
`tests/integration/case-router.test.ts` (admin participant gate
describe block + 12-procedure regression net), `output-router.test.ts`
(5 admin-gate tests across mutation + download paths),
`document-router.test.ts`, `recommender-router.test.ts`,
`me-dashboard-feeds.test.ts` (admin-not-on-case audit), and
`search-global.test.ts` (3 admin-gate tests for the search surface).

Original report retained below.

Surfaced 2026-05-12 (reproduced as admin user on
the attorney dashboard).

`server/db/migrations/0005_rls.sql:138-139` —
`create policy cases_admin on cases for all using (is_admin()) with
check (is_admin())`. Every request sets `app.current_user_id` via
`server/api/trpc.ts:72`. When the session user has `role='admin'` in
`user_roles`, `is_admin()` evaluates true inside ANY RLS check — so
`case.list` (an attorney-scoped procedure) returns every row instead
of only the rows where the session user is a case participant.

This is mechanical bypass, not by-design product behavior. The CLAUDE.md
§6.9 rule is "RLS is the safety net, not the gate" — i.e., the
attorney `case.list` should filter explicitly by the session user in
SQL, and let RLS catch missed cases. Today the procedure trusts RLS,
which collapses for admins.

Recommended fix:
1. `case.list` (and any other attorney-scoped read on `cases`) must
   filter explicitly: `where case_id in (select case_id from
   case_participants where user_id = :ctx.session.user.id and
   removed_at is null)`. RLS stays as belt-and-suspenders.
2. Audit every `is_admin()`-backed `for all` policy in 0005_rls.sql
   and downstream migrations (`organizations`, `case_participants`,
   `case_outputs`, `case_documents`, `invoices`, etc.) for the same
   pattern. Each attorney-scoped procedure on those tables should
   filter explicitly.
3. Admin reads continue to flow through `/admin/*` procedures which
   intentionally do not filter — `admin.listAllCases` etc.

Acceptance: as an admin user, the attorney dashboard shows only cases
where the admin is a participant. The admin console still shows all
cases.

### #58 — Migration pipeline cannot run `CREATE INDEX CONCURRENTLY`

Status: Deferred to Phase 2 traffic. `drizzle-kit migrate` wraps each
migration file in a single transaction; Postgres rejects
`CONCURRENTLY` inside a transaction. Migration `0026_nappy_tenebrous`
ships the `cases_filed_receipt_number_uniq` partial index without
`CONCURRENTLY` for that reason. ADR-006 originally claimed the index
would be concurrent — corrected in the ADR's Consequences section on
2026-05-09. Phase 1 has zero live attorneys, so the brief ACCESS
EXCLUSIVE lock is moot. Before Phase 2 traffic we need a non-tx
migration mechanism (options: a sibling `pnpm db:migrate:concurrent`
script that runs flagged files outside the migrator, or hand-applied
SQL with manual journal updates). Recording so the next contributor
who reaches for `CONCURRENTLY` finds it documented.

### #56 — Structured-output autosave (drafts) deferred for exhibit_index

Status: Deferred — explicit Save is the only mutation path for now.
The stale-draft corruption surface (R1 in the C-review) was closed
2026-05-08 by `approveOutput`'s structured-content validator.
Surfaced: 2026-05-08 (commit C scoping).

`output.saveDraft` writes a markdown string to
`case_outputs.draft_content`. For structured types the equivalent
contract would be: write a (possibly schema-violating) partial
payload as JSON, then have the approve-flush path serialize the
partial payload back through schema validation before committing.
That introduces a parallel draft code path with subtle semantics
(should an invalid draft block approve? what does "flush" mean for a
partial structured payload?) that warrants its own review pass.

Today the editor flips dirty in memory; Cancel resets to the server
canonical, Save commits via `output.updateStructured`. Closed-tab +
reopen drops in-progress edits — same UX as a typical form. Add
structured drafts when the autosave pattern matures.

Related: a stale `case_outputs.draft_content` from before commit B
(when exhibit_index briefly went through TiptapEditor's markdown
path) is currently ignored on load — `OutputDetailPanel.tsx`'s mode
initializer forces `read` for structured types and the editor
baseline is `displayContent` (formatted markdown) in read mode and
`liveContent` (raw JSON) in edit mode. The stale draft never reaches
the renderer. The follow-up structured-draft commit should also
include a one-time cleanup of stale drafts on first structured save.

### #55 — evidence_plan and exhibit_index render as raw JSON in editor + package

Status: Resolved 2026-05-08 by commits A → B → C.
Original surface: 2026-05-08.

Cause: both output types are generated in JSON mode (prompts in
`server/services/computer/prompts/{evidence-plan,exhibit-index}.ts`)
and `_shared.ts:138` writes the raw JSON string into
`case_outputs.content`. The display path (`TiptapEditor` in
`OutputDetailPanel.tsx:489`, `MarkdownRenderer` in
`pdf/exhibit-index-page.tsx:50` and the prose branch of
`pdf/index.tsx:99`) treats `content` as markdown. There is no
JSON→markdown step. `pdf/exhibit-index-page.tsx`'s own header comment
admits "Stage 08 spec defers that to Stage 11 polish" — the polish
never landed.

Why JSON-on-disk is correct: `_context.ts:66` runs
`EvidencePlanSchema.safeParse(JSON.parse(content))` so downstream
prompts (personal_statement, petition_letter) can ground prose against
the structured plan. Switching the storage format to markdown would
break that grounding contract.

Fix options:
1. Server-side render-on-read formatter: JSON → markdown when serving
   to editor + PDF, keep `content` as JSON, make editor read-only for
   these two types (regenerate is the only mutation path).
2. Dual-storage (`content` JSON + `display_content` markdown column).
3. Switch outputs to markdown — risks downstream `.safeParse()` paths.
4. Build a custom Tiptap structured view + real PDF table layout.

Recommended: option 1. Smallest diff, keeps JSON contract, fixes
editor + PDF together. Option 4 is the right long-term destination.

### #54 — Page-number footer dropped to work around react-pdf layout bug

Status: Worked around 2026-05-08. Upstream fix not tracked yet.
Surfaced: 2026-05-08 (user report — "Download Package" 500'd with
`unsupported number: -1.8382390449784194e+21` from
`PDFDocument.translate`).

Cause: `@react-pdf/render@4.5.1` corrupts the layout-state of a
`<Text fixed render={({pageNumber, totalPages}) => ...}>` when it sits
beside another `<Text fixed>` sibling AND the page body is rendered
through `MarkdownRenderer` (many sibling `<Text>` nodes — one per
heading/paragraph) AND the body paginates (≥ ~3 pages). On subsequent
pages the page-number element's translate matrix is built from
uninitialized box values; pdfkit's `number()` validator catches the
~-2^70 result and throws. Each condition alone renders cleanly; the
combination is what breaks.

Workaround: `DisclaimerFooter` now renders only the disclaimer
`<Text fixed>`. Page numbers are gone from rendered PDFs until either
(a) react-pdf releases a fix, (b) we move the page number to a fixed
top-of-page Text (tested cleanly in repro — doesn't trigger the bug),
or (c) we precompute "Page N of M" strings up front. Disclaimer carries
the spec §17 mandate; page numbers were nice-to-have.

Regression test: `tests/integration/pdf-render.test.tsx` —
"renders multi-page markdown content without pdfkit translate failure".
Seeds a 40-section markdown body (3+ pages) and asserts the package
compiles.

Why existing tests didn't catch it: every PDF render fixture uses
one-paragraph content (e.g. `"I am a researcher."`) so multi-page
rendering never got exercised. The user hit it the first time a
package crossed the pagination threshold — not a regression from any
recent code change; the latent bug shipped with the original
`DisclaimerFooter` (commit 445b969).

### #53 — Approve on rec-letter / exhibit-index with pending draft throws ZodError

Status: Resolved 2026-05-08.
Surfaced: 2026-05-08 (user report from outputs tab).

Fix: all three attorney-edit call sites in `server/services/output/index.ts`
(`updateOutputContent`, `restoreOutputVersion`, `approveOutput` flush
path) now inherit the prior row's `metadata` via the SELECT instead of
writing a fresh `{ editedFromVersionId, attorneyId, flushedOnApprove }`
envelope. This both unblocks the strict branches of
`OutputMetadataSchema` AND fixes the latent `recommenderName` /
`provider` / `sessionId` loss that would have manifested as soon as the
strict-branch error was resolved. Audit attribution still flows via
`parent_id` + `author = "attorney"`. Regression test: `tests/integration/
output-draft.test.ts` — "flush-on-approve preserves prior metadata".

Repro: open a `recommendation_letter_template` (or `exhibit_index`)
output, edit it so a `draft_content` exists, click Approve. The server
returns 500:
`Unrecognized keys: "editedFromVersionId", "attorneyId", "flushedOnApprove"`.

Cause: `approveOutput` (`server/services/output/index.ts:970`) flushes
the pending draft via `saveOutputVersion` and stamps these three keys
into `metadata`. `saveOutputVersion` (`index.ts:122`) then runs
`OutputMetadataSchema.parse({ ...metadata, type: outputType })`. The
schema (`server/db/schema/zod/output-metadata.ts`) makes
`RecommendationLetterMetadata` and `ExhibitIndexMetadata` `.strict()`
(closed open_issues #19.4) while `GenericMetadata` remains
`.passthrough()` — so the strict branches reject the flush-attribution
keys; every other output type silently passes them through.

Fix shape: either (a) add a shared base
`{ editedFromVersionId, attorneyId, flushedOnApprove }` to all branches
of `OutputMetadataSchema`, or (b) stop carrying flush attribution in
`metadata` and add real columns / a separate audit row. (a) is the
smaller change; (b) is the right long-term call since these aren't
provider metadata.

Side observation: the flush path passes a fresh `metadata` object
instead of merging onto the prior row's metadata, so the new version
loses provider/sessionId/model attribution. Consider preserving those
when fixing the strict-branch issue.

### #52 — pnpm reports 23 deprecated transitive dependencies on every install

Status: Tech debt — not blocking; clean up incrementally as upstreams release.
Surfaced: 2026-05-06 (during Stage 03b → date-picker install).

Every `pnpm add` re-prints the full deprecation list. Verified via
`pnpm why` that **none** are from packages we directly depend on for
new work — they're all transitive from existing top-level deps. The
fix landscape:

- **17 × `@react-email/*` subdeps + `@react-email/components@1.0.12`**
  — Stage 11 transactional-email stack. The components library was
  marked "no longer supported" by its maintainer; the active package
  is now `@react-email/render` + per-component packages or migration
  to alternatives. Re-evaluate when we wire real Postmark sends in
  Stage 11.

- **`@esbuild-kit/core-utils@3.3.2`, `@esbuild-kit/esm-loader@2.6.5`**
  — pulled by `drizzle-kit` → `@esbuild-kit/esm-loader` → core-utils.
  Drizzle's own dep; resolved when drizzle-kit upstream switches to
  modern `tsx`/`tsimp`. No action on our side.

- **`node-domexception@1.0.0`** — pulled by `inngest` →
  `@opentelemetry/auto-instrumentations-node` → `gcp-metadata` →
  `gaxios`. Three transitive hops; resolved upstream.

- **`serialize-error-cjs@0.1.4`** — Inngest transitive. Same shape.

What we should NOT do:
- Don't add `pnpm.overrides` to silence them — that risks silently
  pinning a sibling to an incompatible version on next bump. The
  warnings are a maintenance signal, not a runtime hazard.

What to do when working in the relevant area:
- During Stage 11 polish: audit `@react-email/components` upgrade
  path and decide whether to migrate or wait.
- On every `pnpm up` of `drizzle-kit` / `inngest`: re-check this list
  and prune entries that are gone.

What was NOT introduced by Stage 03b additions:
- `react-day-picker@9.14.0` pulls only `date-fns` (already locked),
  `@date-fns/tz`, `date-fns-jalali`, `@tabby_ai/hijri-converter`.
- `@radix-ui/react-popover@1.1.15` pulls 13 `@radix-ui/*` siblings +
  `aria-hidden` + `react-remove-scroll`.
- All maintained, none deprecated.

### #50 — Signed recommendation letters are not linkable to specific recommenders

Status: Tracked. Phase-2 schema work.
Surfaced: 2026-05-05

`case_documents` has no FK to `case_recommenders`, so we cannot
determine *which* uploaded `recommendation_letter` corresponds to
which recommender. Today the package compiler and preflight use a
**count-based** check (`signedLetterCount >= recommenderCount` ⇒
treat as fully signed; any shortfall ⇒ watermark every
`recommendation_letter_template` page in the package and stamp the
cover with a "DRAFT" badge + "Pending signed letters" block — see
`server/services/cases/recommender-coverage.ts` and
`server/services/pdf/index.tsx`).

When this is resolved, add a nullable `case_documents.recommender_id`
referencing `case_recommenders(id)`; have the documents-tab UI ask
"Which recommender?" when uploading a `recommendation_letter`; swap
the count-based check for a per-recommender map; and consider
optionally substituting the signed PDF for the AI draft in the
package output.

### #49 — Recommender `update` mutation never refreshes `updatedAt` for empty patches

Status: Tracked.
Surfaced: 2026-05-05

`recommender.update` currently rejects `{}` patches with BAD_REQUEST,
but a client that sends a patch where every value matches the
existing row will still fire the SQL UPDATE → bumps `updated_at` via
the trigger and writes a `recommender.updated` event with `fields`
listing the no-op keys. Cosmetic noise on the timeline; not
incorrect. Fix when the audit log gets denser: pre-compare against
the existing row in the same tx and skip the write when the diff
is empty (mirror `output.saveDraft`'s idempotency check).

---

### #50 — `case.completeIntake` recommender gate is per-visa, but copy is hardcoded "three"

Status: Tracked.
Surfaced: 2026-05-05

`RecommenderListEditor` and the IntakeWizard's section blurb both
say "minimum three for O-1A". The minimum is read from
`visaCriteriaConfig().minRecommenders` server-side, so adding EB-1A
or another visa with a different minimum (or any minimum) will
silently drift the UI copy from the enforced rule. Fix when a
second visa with `minRecommenders` lands: source the copy from
`visaCriteriaConfig` keyed off the case's visa, same as the
existing `requiredDocsFor` pattern.

---

### #47 — Removing `recommendersCount` from `BeneficiaryDataSchema` is a breaking read

Status: Tracked.
Surfaced: 2026-05-05

`BeneficiaryDataSchema` is `.partial().strict()`. Dropping the
`recommendersCount` field rejects any existing
`cases.beneficiary_data` row that still carries it as soon as a read
parser hits it (`extractBeneficiaryFullName`, prompt builders,
intake hydration). Phase 1 has no production traffic; the rollout
plan is a full DB wipe before re-test, so no migration ships. If a
future change reintroduces the field set on existing rows, drop the
column or add a one-shot script that strips legacy keys before
re-loading.

---

### #48 — Recommender reorder mutation exists but not yet wired in UI

Status: Tracked.
Surfaced: 2026-05-05

`recommender.reorder` exists on the router (server-side ordering
is the authoritative source) but `RecommenderListEditor` does not
yet expose drag-to-reorder. Attorneys can add / edit / remove;
ordering follows insert order. Add `@dnd-kit/sortable` to the
editor when an attorney complains — the dependency is already in
`package.json` (used by `PackageAssemblyCard`) so no new install
is required. Closes the gap that `#20` originally flagged for
recommender semantics; #20 itself is resolved by the case-build
fan-out + this UI.

---

### #44 — `package.ready` re-emits on every unapprove → re-approve cycle

Status: Tracked.
Surfaced: 2026-05-03

The `output.approve` mutation
(`server/api/routers/output.ts`) emits
`notification/package.ready` whenever the post-approve approval
summary shows every current output approved. If an attorney
unapproves and re-approves the last output (a real flow during
review), the listener fires again and ships a duplicate
"Filing package ready" email. The Inngest concurrency key
(`event.data.caseId`, limit 1) serializes runs but does not dedupe
distinct events.

Acceptable for beta — an attorney genuinely toggling approval is
exercising a thoughtful re-review and the email points at a freshly
compiled package. Becomes annoying at higher volume.

Fix when needed: stamp `cases.package_ready_emailed_at` on first send,
gate the listener on `IS NULL`. Reset when any current output
flips to `attorneyApproved=false` so a true new "package complete"
state still triggers.

---

### #45 — `notification/case.archived` and friends silently drop on emit failure

Status: Tracked.
Surfaced: 2026-05-03

Three mutation paths
(`case.requestBuild`, `case.archive`,
`output.approve`, `admin.approveWaitlistEntry`) wrap their
`inngest.send(...)` notification emit in `try { ... } catch (err) {
console.error(...) }` so a transient Inngest outage doesn't surface a
TRPCError to the user-visible click path. The trade-off: the email is
silently lost — there's no retry queue at this layer (Inngest's retry
is a level deeper, inside the listener once the event is accepted).

Phase 1 acceptable — Inngest's `/event` ingest is highly available
and a missed welcome / invite is recoverable manually. Phase 2 fix:
write a `pending_notifications` row inside the same DB tx as the
mutation, then a sweeper Inngest cron drains it. That gives true
at-least-once semantics across both DB and Inngest outages.

---

### #46 — Postmark health probe does not verify DKIM/SPF status

Status: Tracked.
Surfaced: 2026-05-03

`pingPostmark()` in `app/api/health/route.ts` calls `getServer()` —
auth-only metadata, free, sub-second. It does NOT call the
`/domains/<id>` endpoint that would surface DKIM and Return-Path
verification status, because that's a separate API call per probe
and the answer almost never changes after initial setup.

Operator path: check the Postmark dashboard after DNS changes; the
README's "Email (Postmark)" section walks through DKIM/SPF/DMARC
setup and the verification check.

If we get burned by a silently broken DKIM rotation, the fix is a
10-minute add: `getDomain(<id>)` behind the same 3s timeout, with
the result reported as a separate `postmarkDkim` field so a missing
DKIM degrades distinctly from a missing API key.

---

### #38 — `admin.case_reassigned` analytics event has no emit site

Status: Tracked.
Surfaced: 2026-05-02

The `admin.case_reassigned` event is declared in
`lib/analytics/events.ts` but no tRPC procedure currently exists to
emit it — there is no `case.reassign` or `admin.reassignCase` mutation
in `server/api/routers/admin.ts`. The event sits in the taxonomy
because Phase 2 multi-attorney workflows will need it; for Phase 1
(solo attorney per case) reassignment isn't a real flow.

Fix when the reassign UX lands: import `emitFromCtx` into the new
mutation, call it after the participant-table swap commits with
`{ case_id, from_attorney_id, to_attorney_id }`. The taxonomy entry is
ready and typed.

No code change today. The dead taxonomy entry costs nothing — TS still
type-checks the unused union member, and PostHog only ever sees event
names that an emit site actually fires.

---

### #39 — Sign-out does not call `posthog.reset()`

Status: Tracked.
Surfaced: 2026-05-02

`components/layout/SignOutForm.tsx` is a server-action form (no
client JS) which means we can't synchronously call
`posthog.reset()` from the click handler before the redirect. The
result: PostHog's `localStorage` retains the previous user's
`distinct_id` until the next `posthog.identify()` fires on the new
sign-in. For the in-between window, anonymous events emitted by a
*different* user signing into the same browser would be attributed
to the previous user.

Phase 1 risk: minimal (single-attorney solo practice; one operator
per machine).

Fix when convenient: extract a thin client-component button
(`<SignOutResetButton/>`) that wraps the existing submit, fires
`reset()` from `lib/analytics/client.ts` synchronously, then submits
the form. Server-action redirect behavior is preserved — the click
handler runs fully before the form post takes effect.

Alternative (simpler, less correct): add a `posthog.reset()` call to
the marketing/landing layout's mount effect. Catches the common
case (sign-out → redirected to `/`) but misses sign-out targets that
land on auth pages.

---

### #36 — `publicEnv` reads dead `NEXT_PUBLIC_SUPABASE_*` vars

Status: Tracked.
Surfaced: 2026-05-02

`config/public-env.ts` exports `supabaseUrl` and `supabaseAnonKey`
sourced from `process.env.NEXT_PUBLIC_SUPABASE_URL` /
`NEXT_PUBLIC_SUPABASE_ANON_KEY`. Neither variable is declared in
`config/env.ts` (the validated server-side schema) — they were stripped
when auth pivoted from Supabase Auth to Auth.js + Drizzle adapter, but
the public-env mirror was missed.

Impact today: dead reads. Both values are `undefined` at runtime; no
known consumer references them. Lint won't catch it because
`process.env.NEXT_PUBLIC_*` reads aren't checked against the validated
schema.

Fix when convenient: drop both lines from `config/public-env.ts`. If
nothing else references the keys (verified via grep), no other change
is needed. Pair with a one-liner test that pins `Object.keys(publicEnv)`
so a future regression — adding back a public env var without also
adding it to `config/env.ts` — fails CI.

Surfaced during PostHog wrapper review (PH.3); not in scope to fix in
the analytics workstream.

---

### #37 — Server analytics uses `captureImmediate` per event

Status: Tracked.
Surfaced: 2026-05-02

`server/services/analytics/server.ts:trackServer` calls
`PostHog.captureImmediate()` rather than the default batched `capture()`.
Rationale: Vercel serverless functions terminate the moment the response
is flushed — a batched event still in the in-memory queue gets dropped
when the container freezes. `captureImmediate` issues an HTTP request
per event, guaranteeing delivery before the await resolves.

Trade-off: per-event HTTP cost (latency + outbound bandwidth) for every
emit on the server. At Phase 1 volumes (one attorney, ~17 emit sites,
mutations measured in tens per day) this is negligible. At Phase 2 scale
the cost picture changes.

Revisit when:
  - We move off Vercel serverless to a long-lived runtime (Fly.io, Render,
    a dedicated VPS) — batched `capture()` + a graceful `shutdown()` on
    SIGTERM becomes the right pattern.
  - Server-side emit volume grows past ~10/sec sustained — at that point
    the per-event HTTP becomes a real budget item and we want
    `captureImmediate` only on the highest-value events (revenue, churn)
    with everything else batched.

No code change for now. The wrapper's docstring already explains the
choice; this entry is the explicit "revisit trigger."

---

### #35 — R2 object-lifecycle policy for soft-deleted documents

Status: Tracked.
Surfaced: 2026-05-01

Soft-deleting a `case_documents` row sets `deleted_at` but the
underlying R2 object stays — indefinitely. For Phase 1 this is fine
(small corpus, no compliance pressure). For Phase 2 it becomes both
a cost line item and a retention-policy gap (legal team has no
mechanism to enforce "delete X days after archive").

Two complementary fixes:
  - **Application-side sweep:** Inngest cron job that walks
    `case_documents WHERE deleted_at IS NOT NULL AND deleted_at <
    now() - interval '30 days'` and calls `storage.delete(storagePath)`.
    Idempotent against Local + S3 backends.
  - **R2 lifecycle rule:** configure the R2 bucket with a "delete
    after N days" rule on a key prefix (e.g. `cases/.../trash/`).
    Requires the soft-delete to also rename the object — heavier
    refactor; skip for Phase 1.

Recommendation for Phase 2: ship the application-side sweep (one
Inngest function, ~30 lines of code, reuses `storage.delete`), defer
the R2 lifecycle rule until volume justifies it.

---

### #34 — Concurrent-edit conflict handling on draft_content

Status: Tracked.
Surfaced: 2026-05-01

`saveOutputDraft` is "last-write-wins" — two browser tabs editing
the same output will trash each other's drafts on each autosave
fire. The current single-attorney-per-case model makes this rare,
but a determined user with two tabs open WILL see surprising
behavior:

  Tab A types "alpha" → autosave commits draft="alpha"
  Tab B types "beta" → autosave commits draft="beta"  
  Tab A continues, autosave commits draft="alpha extra"
  → Tab B's "beta" is silently lost.

For Phase 1, acceptable: the autosave's 3s debounce + the
`saveOutputDraft` `===` idempotency check minimise harm, and the
attorney is the same human across both tabs (they'll notice
divergence and reload).

Phase 2 fix path: `If-Unmodified-Since` style optimistic
concurrency using `case_outputs.row_revision` (already populated
by the existing trigger). Server returns 409 if the autosave's
`expectedRevision` doesn't match, client surfaces "Your draft is
behind. Reload to see the latest." Doesn't auto-merge — the prose
is too high-stakes for a 3-way diff to do silently.

---

### #33 — Highlight matched terms in SearchBar dropdown rows

Status: Tracked.
Surfaced: 2026-05-01

`SearchBar` shows the matched filename / snippet as plain text. A
common autocomplete affordance is to bold the matched substring
(`Maria` highlighted inside `Maria Gonzalez`) so the user sees
WHY each row matched. Skipped for Phase 1 because:

  - Per-row regex-replace is cheap but risks RegExp-injection if
    the needle is user-supplied (escape it via the same trick
    `escapeLike` uses on the server side).
  - Diacritic-insensitive matching (search "Maria" → highlight
    "María") needs `String.prototype.normalize('NFD')` plus a
    diacritic strip — modest, but additional surface area.
  - Trigram results don't always have a contiguous substring
    (similarity match like `Marisol` ↔ `maria` shares `mar` but
    not `maria`). Highlighting needs to be substring-aware AND
    fuzzy-aware, which is two passes.

Logged for the polish pass. Non-blocking.

---

### #32 — SearchBar document hits route to the page, not the doc

Status: Tracked.
Surfaced: 2026-05-01

`components/layout/SearchBar.tsx` navigates document hits to
`/case/[caseId]/documents` — the page, no anchor. There's no
per-document detail route or in-page focus mechanism today, so
landing the user on the documents list is the closest available
target. After arriving, the user has to scan the list visually for
the row they searched for.

Fix options:
  - URL hash: `/case/.../documents#doc-{id}` + `scrollIntoView` +
    a brief highlight on the row in `DocumentsPanel.tsx`.
  - Query string: `?focus={id}` for a more explicit contract.
  - A dedicated `/case/[id]/documents/[docId]` route.

Hash approach is the smallest change and matches established web
behavior. Logged for the next polish pass; non-blocking because the
search already gets the user 95% of the way there.

---

### #31 — Phase 2: replace trigram search with tsvector + GIN

Status: Tracked.
Surfaced: 2026-05-01

Stage 11 W5 ships trigram (`pg_trgm`) GIN indexes for the topbar's
global search — fuzzy similarity for case beneficiary names +
filenames, substring containment (`LIKE` over the trigram index) for
the first 4000 chars of `case_documents.extracted_text`. See
`server/db/migrations/0019_search_trigram_indexes.sql` and
`server/api/routers/search.ts`.

Trade-offs that bite at scale:

  - **4000-char prefix on extracted_text.** Catches CV summaries,
    cover-letter openings, abstracts. Misses deep-document matches
    (a citation in §VII won't surface). Small attorneys (Phase 1
    target: <50 cases) will rarely notice; an attorney with hundreds
    of large evidence PDFs will.
  - **Substring containment != ranked relevance.** A doc-body hit
    scores binary 1.0; ties break alphabetically by filename. Real
    relevance ranking (term frequency, inverse-doc-frequency,
    proximity) needs `tsvector` + `ts_rank` / `ts_rank_cd`.
  - **No language-aware stemming.** Trigrams treat "running",
    "runner", "runs" as separate; tsvector stems them with the
    English (or other-language) dictionary.

Phase 2 upgrade path:

  1. Add `case_documents.extracted_tsv tsvector` generated column:
     `GENERATED ALWAYS AS (to_tsvector('english', extracted_text))
     STORED`.
  2. GIN index on `extracted_tsv`.
  3. Search router branches: short queries (<3 chars) keep using
     trigram (handles diacritic-typo names); longer queries use
     `to_tsquery` + `ts_rank_cd` for relevance.
  4. Drop the 4000-char cap and the substring-containment branch.

Decision recorded for the W5 commit: ship trigram now, defer
tsvector to Phase 2 — Phase 1 corpus is small enough that the
4000-char cap is invisible, and trigram handles non-English names
better than English-stemmer tsvector for Phase 1's primary
use case (autocomplete a beneficiary's name).

---

### #30 — Stale "Auto-saved · just now" on draft-recovery load

Status: Tracked.
Surfaced: 2026-05-01

`app/(app)/(workspace)/case/[id]/outputs/[outputId]/OutputDetailPanel.tsx`
— when the page loads with a pending draft, `autoSavedAt` is
initialized to `new Date()` so the toolbar shows "Auto-saved · just
now" regardless of when the server actually persisted the draft.
Could have been an hour ago.

Fix requires either (a) a `case_outputs.draft_updated_at` column
shipped to the client via `output.get`, or (b) using the existing
`updated_at` (but that bumps on `attorney_approved` toggles too — not
draft-specific). Option (a) is the right answer — small migration +
one set + one read. Logged for the next polish pass; non-blocking
because the timestamp's only role is informational.

---

### #29 — Verify R2 deploy preview end-to-end (W1.7)

Status: Pending — requires founder action.
Surfaced: 2026-05-01

W1 ships the `S3Storage` adapter + env validation + 14 passing unit
tests against a mocked SDK. What the tests cannot cover: a real R2
bucket actually accepts our `PutObjectCommand` payloads, and a browser
can fetch the presigned URL from R2's CDN without CORS errors.

Action: deploy a preview branch with `STORAGE_BACKEND=s3` + R2 creds
in Vercel env, upload a document via the case documents page, and
confirm (a) the file appears in the R2 bucket, (b) the signed URL
returns 200 in a browser tab. If signed-URL fetches fail with CORS,
configure the R2 bucket's CORS policy to allow the production /
preview origin (`https://*.vercel.app` and the prod domain) for `GET`.

If `forcePathStyle: true` causes R2 to reject signed URLs (some R2
configurations prefer virtual-hosted-style for the public URL), flip
to `false` in `server/services/storage/s3.ts:60` and re-test.

---

### #25 — IntakeWizard cleared text fields don't propagate to server

Status: Tracked.
Surfaced: 2026-04-30

`components/case/IntakeWizard.tsx:175-186` — `flushSave` builds the
patch from non-empty values only (Zod's `.min(1)` would reject an
empty string). When the attorney clears a previously-saved text field
(e.g. notes was "foo", now ""), the field is omitted from the patch,
and the server's shallow-merge keeps "foo". The UI shows empty; the
DB has stale data. Fix requires sending an explicit `null` (and
schema accepting `null` to mean "clear"), or a wizard-level "delta"
patch that distinguishes "field not edited" from "field cleared".
Not blocking — attorneys rarely clear once typed — but logged for
the polish pass.

---

### #26 — Package saved-order fallthrough buries new outputs at the bottom

Status: Tracked.
Surfaced: 2026-04-30

`server/services/pdf/index.tsx:251-273` and
`app/(app)/(workspace)/case/[id]/package/page.tsx:62-81` — when
`cases.package_order` is populated and a regenerate produces a NEW
output (key not in the saved array), the new output sorts AFTER every
saved-order key, then by canonical rank within the unsaved cluster.
Result: a new recommendation letter shows up at the bottom of the
package even if its canonical position is mid-list. The attorney has
to drag it back. Fix: insert new keys at their canonical rank
position relative to the saved keys (interleave). Low frequency
(only after regenerate-while-already-reordered).

---

### #27 — `PackageAssemblyCard` has no unit test

Status: Tracked.
Surfaced: 2026-04-30

The Day 4.2 sweep added unit tests for every other Stage 11 γ
component but skipped `components/case/PackageAssemblyCard.tsx`.
DnD-kit's PointerSensor / KeyboardSensor doesn't render predictably
under jsdom (no PointerEvent), and a meaningful test needs the
`@dnd-kit/core` test utilities. Defer until either a Playwright path
opens or `@dnd-kit` ships a vitest-compatible test harness. The
mutation chain + rollback path can still be tested without the DnD
event by exporting `onDragEnd` directly — that's the simpler win.

---

### #28 — `packageKeyFor` uses `:` separator that could collide with future enum values

Status: Tracked.
Surfaced: 2026-04-30

`server/services/pdf/package.tsx:44-51` — `packageKeyFor` joins
`outputType:subgroupKey`. If a future `OutputType` enum value
contains a colon (e.g. `"i129:e"`), the parsed key would collide
with a real subgroup key from a different output. Currently
impossible (every enum value is `[a-z_]+`), but the contract should
make the assumption explicit. Add a runtime assert (or a unit-test
guard) that no `OutputType` contains `:`.

---

### #23 — Stage 11 γ wizard fields captured but unused downstream

Status: Tracked.
Surfaced: 2026-04-30

`BeneficiaryDataSchema` (server/db/schema/zod/beneficiary.ts) gained
`field`, `yearsActive`, `targetFilingDate`, `recommendersCount` for the
new `IntakeWizard`. The wizard captures and persists them, but nothing
downstream reads them — `recommendersCount` in particular is the
attorney's planned letter count, yet:
- `requiredDocsCoverage` keeps `rec_letters` hardcoded at `minCount: 3`
  in `lib/visa-criteria.ts:135`.
- `case.preflight`'s `recommender_letters` gate flips green at >0
  approved letters (`server/services/cases/preflight.ts:143`).
- `targetFilingDate` and `yearsActive` are not surfaced on the case
  Overview, in any prompt's `_context.ts`, or on the package cover.

Three sources of truth disagree on "how many recommenders". Either
delete the unused fields or wire them into the checklist threshold +
preflight gate + cover sheet. Default action: read `recommendersCount`
into the `rec_letters` minCount and the recommender_letters preflight
gate; surface `targetFilingDate` on the case header.

---

### #24 — IntakeWizard concurrent-save race on `revisionRef`

Status: Tracked.
Surfaced: 2026-04-30

`components/case/IntakeWizard.tsx:200-205` increments `revisionRef` in
`onSuccess`. If the user types fast enough that the second debounce
fires before the first mutation resolves, both saves submit the same
`expectedRowRevision` and the second hits CONFLICT (the error renders;
the typing isn't lost but the toast surface is noisy). Fix: gate
`flushSave` on `update.isPending`; the next keystroke re-schedules
when the in-flight save returns. Low-frequency edge — only repros on
slow networks with continuous typing.

---

### #4 — RLS test coverage is canary-only on writes

Status: Tracked.
Surfaced: 2026-04-27

`tests/integration/rls.test.ts` (29 tests) covers SELECT visibility for
every RLS-protected table. **Zero tests prove `WITH CHECK` clauses
actually block UPDATEs that try to move a row out of visibility.** Add
~10 mutation tests when Stage 05 begins exercising real writes.

---

### #7 — `case_participants.role` consistency with global `user_roles`

Status: Service-layer enforcement; not constrained at DB.
Surfaced: 2026-04-27

A user without the global `attorney` role in `user_roles` can be inserted
into `case_participants` with `role = 'attorney'`. Postgres has no way
to express "the user must hold this global role" without a check function.

**How to apply:** Stage 05's `case.addParticipant` service procedure must
verify `user_roles` membership before insert. If we ever add a
participant role beyond global roles (e.g., `observer` doesn't need a
global role), document the exception.

---

### #8 — Stage 03 UX gaps deferred to Stage 09 admin polish

Status: Documented; functional but not polished.
Surfaced: 2026-04-30 (Stage 03 review)

1. **`OnboardingForm` silent no-op on missing fields** —
   `app/(app)/onboarding/OnboardingForm.tsx` returns early without showing
   an error when `barNumber`, `agreementFilename`, or terms checkbox is
   empty. Browser `required` attribute catches most cases, but the form
   should surface its own errors. Trivial fix; deferred for now.

2. **`ActivateButton` has no confirm dialog + no reason input** —
   `app/(admin)/admin/attorneys/ActivateButton.tsx` is one-click. CLAUDE.md
   §5 (admin section) mandates "Activate / Suspend actions show confirm
   modal with reason field, stored in `audit_log.details`." The procedure
   accepts a `reason` arg; the UI doesn't pass it. Stage 09 ships the
   polished modal.

3. **`/onboarding` and `/admin/attorneys` pages have no rendering tests** —
   their underlying tRPC procedures are well-covered (14 tests in
   `attorney-onboarding.test.ts`), but the page components themselves
   aren't exercised. Manual smoke after sign-in.

---

### #22 — `updateOutputContent` doesn't lock the parent row before approval check

Status: Documented; Phase-2 multi-attorney concern.
Surfaced: 2026-04-29 (Stage 08 Phase F deep audit)

`updateOutputContent` reads `parent.attorneyApproved` without a row
lock, then calls `saveOutputVersion` which only locks the `cases` row.
Race window: attorney A approves while attorney B is mid-edit; B's
stale read shows `attorneyApproved=false`, B's save proceeds and flips
A's just-approved row to `is_current=false` — effectively unapproving
without notice.

Phase 1 spec is single-attorney-per-case so the race can't happen
today. Stage 11 (multi-attorney support, Phase 2) needs to:
   a. `for("update")` the output row inside `updateOutputContent`'s tx
      so the approval check is serialized; OR
   b. Re-check `attorneyApproved` inside `saveOutputVersion`'s flip
      query (would require threading the parent state through).

Recommendation: (a). Single point of change, no signature ripple.

---

### #21 — `regenerate-output` for `evidence_plan` doesn't update `cases.evidence_plan`

Status: ✅ RESOLVED 2026-04-29 (Stage 08 Phase C). Migration 0012
dropped the `cases.evidence_plan` jsonb column entirely;
`loadBuildContext` now resolves the plan from the latest `is_current`
row in `case_outputs` (single source of truth). Recommendation (b)
from the original entry implemented.

Surfaced: 2026-04-29 (Stage 07 final test-coverage pass)

`regenerate-output` (Phase 10) calls `runOutputJob` → `saveOutputVersion`,
which writes a new `case_outputs` row but does NOT update the
`cases.evidence_plan` jsonb column. The parent `case-build` orchestrator
DOES update that column (step "persist-evidence-plan") before fanning
out the prose outputs.

Consequence: if an attorney regenerates `evidence_plan` via the Stage 8
review UI, the new evidence plan is saved as `case_outputs` v2 but
`cases.evidence_plan` keeps the old jsonb. Subsequent `regenerate-output`
calls for `personal_statement` / `petition_letter` / etc. read the stale
plan via `loadBuildContext`.

Mitigations to pick from in Stage 08:
   a. Have `regenerate-output` parse + persist the evidence plan when
      `outputType === "evidence_plan"` (mirroring the parent's step).
   b. Make `loadBuildContext` resolve `evidencePlan` from the latest
      `case_outputs` row (single source of truth) instead of from the
      jsonb shortcut on `cases`. Costs one extra query but eliminates
      the divergence.
   c. Block `regenerate-output` for `evidence_plan` and require a full
      `case.requestBuild` rerun. Heaviest UX cost.

Recommendation: (b). Removing the jsonb shortcut on `cases` is a small
refactor and removes a class of "two sources of truth" bugs.

---

### #20 — Multi-recommender letter `is_current` semantics

Status: Documented; deferred to Stage 08.
Surfaced: 2026-04-29 (Stage 07 Phase 9 — sub-function build)

`saveOutputVersion` (Stage 07 Phase 7) flips every prior `is_current=true`
row in `(case_id, output_type)` to `false` before inserting the new row.
This is correct for single-output types (`evidence_plan`,
`personal_statement`, `petition_letter`, `exhibit_index`,
`criteria_analysis`) but wrong for `recommendation_letter_template`,
which fans out one row per recommender — so only the LAST letter saved
ends up `is_current`, and earlier recommenders' letters disappear from
the current set.

Phase 9 ships the lossy behavior intentionally: the version history
still retains every letter, and the parent's per-case concurrency=1
serialization makes the order deterministic. Stage 08 (output review)
needs to pick one of:

   a. **Per-recommender stable id on `case_outputs`.** Add a column
      (e.g. `subgroup_key text`) and scope the partial unique index +
      the is_current flip to `(case_id, output_type, subgroup_key)`.
      Cleanest semantics; small migration.
   b. **Bundle into one output.** Parent waits for every recommender
      letter, then writes a single `recommendation_letter_template` row
      whose content is a concatenation. Lose per-letter regenerate
      granularity but keep the schema unchanged.
   c. **Relax `is_current` for this type only.** Service-layer rule:
      "skip flip when outputType=recommendation_letter_template." Cheap
      but creates an asymmetric invariant that's easy to forget.

Recommendation: (a). Aligns with how Stage 08's review UI will need to
identify each letter individually anyway.

---

### #19 — Stage 07 cleanup-pass deferrals

Status: Documented; surfaced during Phase 7.5 cleanup before Phase 8.
Surfaced: 2026-04-28 (Stage 07 mid-stage review)

Items intentionally not fixed in the cleanup pass — each has a clear
owner phase / stage where it lands more naturally:

1. **`SonarClient.ping()` makes a real billable Sonar call.** Phase 12
   wires a 5-min cron + a 1s `/api/health` probe against this. At
   `sonar-pro` rates the per-call cost is fractions of a cent, but the
   cron runs ~288×/day with no payoff (Sonar status doesn't change
   every 5 min). **Phase 12 fix:** cache the result in Redis with a
   5-min TTL; the cron writes the cache, the health probe reads it.
   Avoid the billable call in the synchronous request path entirely.

2. **No context-window pre-flight in `SonarClient`.** Stage 7 spec
   §10.5 said: *"estimate tokens with `length/4` ... if over budget,
   summarize each document via Claude first."* `estimateTokens()` now
   lives in `pricing.ts` (shared with the mock), but no caller wires
   it into a pre-flight check yet. Today an oversize prompt → Sonar
   400 → `ComputerError("InvalidInput")` → case to `build_failed`.
   Loud + fail-fast, but no recovery path. **Phase 9 fix:** sub-
   functions add a pre-flight `estimateTokens(systemPrompt + userPrompt)
   < SONAR_CONTEXT_BUDGET (180_000)` check; over-budget prompts get
   per-doc text truncation before the call. The summarize-then-rerun
   flow stays deferred to post-beta (would need a fallback model we
   don't have per Decision #C).

3. **`server/services/output/index.ts` barrel-as-module naming.** Other
   services use named files (`server/services/cases/transition.ts`).
   This one ships as `index.ts` with multiple exports. Inconsistent
   but harmless — the barrel pattern is also used by
   `server/services/computer/prompts/index.ts`. Pick a convention and
   stick to it during a quiet stage; not worth churning during active
   build.

4. **`OutputMetadataSchema` is `z.union`, not `z.discriminatedUnion`.**
   The `GenericMetadata` branch is `passthrough()`, so the typed
   branches (`recommendation_letter_template`, `exhibit_index`) are
   effectively unreachable for validation — any malformed shape on
   those `type` values would silently match the generic branch.
   Fix: `z.discriminatedUnion("type", [...])` so the typed branches
   are picked correctly. Stage 8 (output review) is the natural
   landing — the per-type metadata shapes get locked there.

5. **`SonarClient.ping()` doesn't pre-flight-check the API key
   format.** Today a malformed key → first real call throws
   `AuthenticationError` → mapped to `ComputerError("NotConfigured")`.
   Acceptable, but a smarter health probe would also surface "key
   present but invalid" distinctly from "no key set." Bundle with #1.

6. **`z.toJSONSchema` results cast to `Record<string, unknown>`.** The
   Sonar SDK's `response_format.json_schema.schema` field is typed as
   `Record<string, unknown>`; Zod 4's `z.toJSONSchema` returns a more
   specific type. Cast keeps the SDK type happy; if the SDK tightens
   its `schema` type, drop the cast. Tracked here so the diff is
   small + obvious when it lands.

---

### #18 — Stage 09 admin dashboard deferred items

Status: Documented; non-blocking polish from the Stage 09 build.
Surfaced: 2026-04-28 (Stage 09 implementation)

**Schema gaps (block KPI fidelity, not page rendering)**

1. **No `compute_category` enum on `case_compute_ledger`.** The Compute
   page shows a single rolled-up total because the ledger doesn't yet
   distinguish inference / embeddings / OCR / storage spend. Stage 07 +
   10 should add the enum + populate it on every ledger insert. Today
   the page renders an `EmptyState` card pointing at this issue.
2. **No `readiness_score` column on `cases`.** The mockup's per-case
   readiness score (87, 74, …) lives inside `cases.criteriaAnalysis`
   JSONB. Pages can't sort/filter on it without either a generated
   column or service-layer extraction. Defer until the build pipeline
   actually populates `criteriaAnalysis`.
3. **No `rfe_status` on `cases`.** Mockup highlights "RFE received"
   risk. Today inferred only from `status='needs_revision'`. Add a real
   column when USCIS RFE handling lands.
4. **No `model_versions` table** for the "claude-opus-4 sunset May 15"
   alert. Hardcoded text on the compute page; Stage 10 adds proper
   model-versioning + sunset-date metadata.
5. **No revenue ledger / Stripe Treasury sync.** Revenue page sums
   `cases.case_fee_cents` directly — works for the dashboard but won't
   reconcile against actual Stripe payouts. Stage 10 adds an `invoices`
   table + Stripe webhook sync.

**Performance / index gaps**

6. **`cases(filed_at DESC) WHERE deleted_at IS NULL`** — the revenue
   aggregation window-scans `filed_at`. Cheap today (small table); add
   the partial index before scaling beyond ~10k cases.
7. **`audit_log(action, created_at DESC)`** — the audit page's prefix
   filter does an action `LIKE prefix.%` scan. Composite index speeds
   the filter + sort once the table grows past ~100k rows.
8. **Per-attorney case counts** are stubbed at `0` in `listAttorneys`.
   Mockup shows "active / filed / revenue 30d / approval rate" per row.
   Real counts need a GROUP BY join through `case_participants` —
   acceptable to defer until we have production data; service-layer
   aggregation now would just add latency for zero benefit.

**Audit + observability**

9. **Hash-chained audit log not implemented.** Mockup shows
   "Verified · 2 min ago" with chain proof. Today rendered as a static
   "ships in a later stage" line on `/admin/audit-log`. Real chain
   verification + cryptographic head hash is a Stage 11 / 12 task.

**Tests**

10. **No page-render smoke tests for the six admin pages.** RSC + tRPC
    server caller is hard to render in JSDOM without a Playwright/E2E
    setup. `pnpm build` exercises the full type-checked render path,
    which catches the same class of bugs (unresolved imports, prop type
    mismatches, missing exports). Add real E2E coverage when Playwright
    lands post-beta (per CLAUDE.md §5).

**Component library debt**

11. **`StatBand` cell highlight (`active`) only renders a top-border
    accent.** Mockup also shows the value text in `--accent` color.
    Mostly there, but a hover→active state polish pass will catch
    differences.
12. **`PageHeader` actions slot has no built-in "primary action" button
    style.** Pages currently inline `<button>`/`<Link>` markup if they
    want a CTA. Stage 11 polish adds a dedicated `<Button>` primitive
    in `components/ui/` so admin actions look uniform.

---

### #17 — Invite-gate hardening follow-ups

Status: Documented; non-blocking polish from the invite-gate slice.
Surfaced: 2026-04-28 (post-Stage 03 hardening)

1. **No email notification on approval.** Today, an admin approves a
   waitlist entry and the user has no way to know. Wire Postmark in
   Stage 11 to send "you're approved — sign in here" with a link to
   `/login`. Until then, founder reaches out manually.
2. **No revoke / un-approve action in `/admin/waitlist`.** Once
   approved, the only way to keep a user out is to suspend the
   resulting attorney profile (Stage 09 admin polish). Acceptable:
   approval is rare and intentional; revocation by deleting the
   waitlist row would still let an existing user (with `users` row)
   sign in via the returning-user branch.
3. **No founder-bootstrap doc.** The README should mention the one-shot
   SQL the very first founder runs to seed themselves as an approved
   waitlist entry + admin role. Add to `README.md` setup section.
4. **`listWaitlist` is unpaginated.** Fine while volume is tiny; add a
   `(createdAt, id)` keyset cursor at ~200 entries.
5. **`signIn` callback runs an unmemoized DB query per OAuth attempt.**
   At our scale (sub-1000 sign-ins/day) this is invisible, but a flood
   of unsigned-up users hammering Google OAuth could thrash the gate.
   Phase 2: add Upstash rate-limit on `not-invited` rejections by IP.
6. **No test asserts that the `signIn` callback returns the redirect
   URL on rejection.** The pure gate function is covered (7 cases) and
   the admin surface is covered (8 cases), but the wire-up between the
   two — the literal callback in `server/auth/config.ts` — is only
   verified manually. Worth adding once Auth.js exposes a test harness.

---

### #9 — Lint rule for `accounts` import outside `server/auth/`

Status: Documented but never written.
Surfaced: 2026-04-29 (Stage 02 review)

The `accounts` table holds OAuth refresh/access/id tokens (tagged
`SECRET:high`). Stage 02 review noted we should add an ESLint
`no-restricted-imports` rule blocking imports of `accounts` from
anywhere outside `server/auth/`. Never implemented. ~5-line eslint
config addition.

---

### #16 — Stage 06 review backlog

Status: Documented; remaining low-priority items from the Stage 06 review.
Surfaced: 2026-04-27 (Stage 06 review)

1. **Storage `put` happens inside the DB transaction** in
   `uploadAndExtract`. If the surrounding tx rolls back AFTER `put`
   succeeded, an orphan file remains on disk. Phase-2 fix: do `put`
   first, capture the key, then insert the row referencing it; on row
   insert failure, `delete` the file (best-effort).
2. **`DocumentsPanel`'s local `Doc` type duplicates the router output
   shape** — could derive from `RouterOutputs['document']['list'][number]`
   to stay in sync. Cosmetic.
3. **No download UI on uploaded documents** — `getDownloadUrl` exists
   in the router but DocumentsPanel doesn't expose a "Download" link.
4. **DocumentsPanel uploads files sequentially** (`for...of`). For a
   multi-file drop, parallel `Promise.all` would be faster. Not a bug.
5. **`randomToken` exported from `local.ts` is unused** — leave for
   when future flows need an unguessable token.
6. **No direct test for `verifySignedUrl`** — it's exercised indirectly
   by `getDownloadUrl` returning a valid URL, but unit coverage of the
   HMAC + expiry logic would catch regressions.
7. **No active-tab indicator on the Documents page** — the case detail
   nav shows "Overview" highlighted; the documents page doesn't have a
   sub-nav at all. UX polish for Stage 00b/00c (design system).

---

### #15 — Stage 06 deferred (document management)

Status: Documented; functional but several deliberate Phase-1 cuts.
Surfaced: 2026-04-27 (Stage 06 implementation)

1. **Storage backend is local-fs only** — `LocalStorage` writes under
   `./storage/`. No production backend yet (S3/R2/Supabase Storage).
   Stage 12 implements `S3Storage` against the same `Storage` interface
   and switches via env (`STORAGE_BACKEND=s3`). Until then prod can't
   ship.
2. **Synchronous extraction in the upload procedure** — pdf-parse runs
   inline. For large PDFs the upload response can take 5–10s. Stage 07
   moves extraction to an Inngest function that reuses the same
   `extractAndPersist()` service.
3. **Server proxies all file bytes** — `document.upload` accepts
   base64-encoded content via tRPC. Phase 2 swaps to direct-to-bucket
   presigned uploads.
4. **No magic-byte MIME validation** — we trust the declared `mimeType`.
   CLAUDE.md §8 mandates server-side magic-byte sniff. Add when uploads
   come from less-trusted sources than authenticated attorneys.
5. **No image OCR** — image MIMEs are in the allowlist but `extract()`
   returns "unsupported" for them. Tesseract.js adds 50MB; defer.
6. **No per-case 500 MB cap** — per-file 25 MB is enforced. Spec §13.3
   wants the per-case ceiling too.
7. **No virus scanning** — Phase 2 if adversarial uploads appear.
8. **`/api/files/[token]` returns `application/octet-stream`** — sniff
   by extension and set the right content-type for inline preview.
9. **Extraction triggers no case status transition** — Stage 07 adds
   `case.markDocumentsComplete` to flip `documents_pending` →
   `extracting` → `ready_to_build`.
10. **No tests for the Documents page UI** (`DocumentsPanel.tsx`) —
    procedures are well-covered (10 tests).
11. **Base64 path isn't validated** — `Buffer.from(garbage, "base64")`
    returns whatever; failures surface in pdf-parse with a useful
    error.

---

### #14 — Stage 05 review backlog

Status: Documented; everything else from the careful review pass on Stage 05.
Surfaced: 2026-04-27 (Stage 05 review)

1. **`appErrorCode` helper duplicated** — `server/api/trpc.ts` (full
   mapping) + `server/api/routers/case.ts` (subset). Move to
   `lib/errors.ts` once a third caller appears.
2. **"Authz via ctx.db, then write via ownerDb" pattern repeated** in
   4 case procedures (create / archive / updateBeneficiary /
   completeIntake). Extract `withCaseAuthz(caseId, fn)` helper if a
   fifth procedure adopts it.
3. **Status string formatter** — `s.replace(/_/g, " ")` written
   inline in dashboard + case detail. Move to a `formatStatus()`
   helper in `lib/case-status.ts` when a third caller appears.
4. **Beneficiary jsonb casts in pages are redundant** —
   `(data.beneficiaryData as { fullName?: string } | null) ?? {}` in
   case detail / intake / dashboard. Drizzle's `.$type<>()` already
   infers `BeneficiaryData | null`. Direct field access with optional
   chain works without the cast. Cosmetic.
5. **No test for `case.create` PRECONDITION_FAILED** path (user with
   no organization). Hard to construct in current seed; add when seed
   has a user-without-org fixture.
6. **No test for `case.archive` from a non-participant** — RLS would
   deny via the authzCheck read, returning NOT_FOUND. Worth a test.
7. **`reviewSlaHours` is stored but unenforced** — no reminder email,
   no overdue UI. Phase 1 acceptable; Stage 11 (notifications) wires
   it.
8. **`case.list` returns full beneficiaryData jsonb in every row** —
   for a 25-item page that's potentially 25 KB. Could project just
   the fullName on the list endpoint and require `case.get` for full
   data. Pre-optimization; phase 2 if measured.

---

### #13 — Stage 05 RLS bypass pattern + deferred items

Status: Documented; functional but expanding the RLS bypass pattern.
Surfaced: 2026-04-27 (Stage 05 implementation)

1. **Several `case` procedures use the owner connection (RLS bypass) for
   writes** because the policies block the operation. Specifically:
   - `case.create` — bootstrap problem: `cases.WITH CHECK` requires
     `user_in_case(id)` but no participant exists yet on a fresh case.
   - `case.archive` — sets `deleted_at`, which flips the policy's
     `deleted_at is null` predicate to false → UPDATE rejected.
   - `case.updateBeneficiary` — writes to `case_events`, which has no
     participant INSERT policy.
   - `case.completeIntake` — same (writes case_events via transitionCase).

   In all four, **app-layer auth runs first** via the RLS-engaged
   `ctx.db` (membership check or case visibility read), and only then
   does the actual mutation run on `ownerDb.transaction()`. Documented
   in each procedure. Pattern is correct but more bypasses than I'd like.

   **Phase-2 fix:** add proper INSERT policies so participants can write
   case_events / cases via their own role:
   - `case_events_participant_insert`: allow when `user_in_case(case_id)`
   - `cases_member_insert`: allow on insert when `user_in_org(organization_id)`
   - Don't gate `cases` UPDATE on `deleted_at is null` in WITH CHECK
     (only USING) so soft-delete works.
   Then drop the owner-bypass paths in the case router.

2. **No tests for the case detail / intake / dashboard pages** — only
   the procedures underneath. Manual smoke after sign-in.

3. **`case.list` cursor pagination uses `createdAt < cursor.createdAt`
   only** — the `id` tiebreaker in the cursor object is captured but
   not used in the WHERE. Two cases with identical timestamps could
   both fall on the page boundary. Vanishingly rare; document.

4. **Beneficiary jsonb merge is shallow** — `{ ...existing, ...patch }`.
   Nested objects in patch overwrite nested objects in existing entirely.
   Phase 1 BeneficiaryDataSchema is flat; harmless. Stage 06+ may add
   nested fields where this matters.

5. **`appErrorCode` helper duplicated** between trpc.ts (full) and
   case.ts (subset). Could DRY when more routers throw AppError.

6. **No participants-management procedures yet** — adding/removing
   paralegals from a case (case_participants_primary_insert RLS policy
   exists but no tRPC procedure exposes it). Stage 09 admin work.

---

### #12 — Stage 04 deferred (waitlist + marketing)

Status: Documented; functional but not polished.
Surfaced: 2026-04-27 (Stage 04 review)

1. **No rate limiting on `marketing.joinWaitlist`** — Upstash Redis is in
   the env schema but not wired. A bot (or a typing visitor) could spam
   the endpoint. Honeypot defeats simple bots; still want per-IP cap
   (e.g. 5/min) once Upstash is live.
2. **No CAPTCHA / Turnstile** — honeypot only. Phase 2 if abuse appears.
3. **No PostHog `waitlist_signup` event** — env keys not configured;
   `lib/posthog.ts` stubs no-op when missing. Wire in Stage 11
   (notifications/polish) after PostHog account exists.
4. **`/terms` and `/privacy` are Phase-1 placeholders** — founder must
   replace with legal-reviewed copy before launch. Bumping
   `TERMS_VERSION` (in `server/auth/terms.ts`) re-prompts every attorney
   to re-accept.
5. **Robots.txt uses `NODE_ENV === 'production'`** — but Vercel preview
   deploys also set `NODE_ENV=production` and would `allow:"/"`. Should
   gate on `VERCEL_ENV === 'production'` once the env var is added.
   Until fixed, preview deploys risk SEO indexing.
6. **No tests for landing page rendering** — `app/page.tsx` and
   `WaitlistForm` are exercised manually only. The procedure underneath
   is well-covered.

---

### #10 — Performance optimizations (measured pre-empt)

Status: All deferred until measured. Listed so we don't lose them.
Surfaced: across Stages 02–03 reviews

1. **`proxy.ts` calls `auth()` on every request** — DB query per page
   render. Could short-circuit on cookie absence. Pre-optimization.
2. **tRPC `createTRPCContext` calls `auth()` per request** — same path
   as proxy. Together: 2 session queries per page that uses tRPC.
3. **`<TRPCReactProvider>` wraps marketing + login pages** that don't
   use tRPC. Could lift into the `(app)` route group only.
4. **`adminProcedure` middleware does `is_admin()` SQL per call** —
   could cache per-request once we have a request-context cache.
5. **`onboarding/page.tsx` runs `me.current()` then redirects** when
   user is active — wasted query on every dashboard-bound user. Could
   check `me.attorneyProfile` lazily.
6. **`admin.listPendingAttorneys` doesn't paginate** — fine at < 50 rows,
   real concern past 1k.

---

## Phase-2 backlog

### #3 — Phase-2 follow-ups recorded during Stage 01

Items intentionally deferred:

1. **`case_events` partitioning by month** — declarative partitioning
   becomes mechanical once row counts hit ~10M.
2. **`audit_log` partitioning** — same.
3. **`case_outputs.content` to object storage** at >1MB per row.
4. **Output pruning job** — drop unpinned, non-current versions older
   than N days. Stage 11.
5. **Read replicas** for eligibility-engine reads.
6. **GIN index on `attorney_profiles.bar_states`** when state-search
   becomes a feature.
7. **PII inventory CSV script** — emits a CSV of tagged columns.
8. **Slug reserved-word blocklist** for `organizations.slug`.
9. **Column-level encryption** for `accounts.refresh_token`/`access_token`/
   `id_token` and `sessions.session_token`. Currently rely on Postgres
   at-rest encryption (provider-managed). At consumer scale + SOC 2 prep,
   move to `pgcrypto` symmetric encryption with a per-deployment key in
   KMS / a vault.
10. **Hard-delete pathway** for GDPR right-to-erasure — separate from
    soft-delete. `eraseUser()` function nulls PII columns and writes an
    `audit_log` entry. Stage 09 stub.
11. **Multi-attorney firms** — `organization_members` already supports it;
    UI for invites/seats is Phase 2.
12. **Session-pruning cron** — Auth.js doesn't auto-delete expired
    `sessions` rows; needs an Inngest daily job. (Was #6 in active —
    promoted to Phase-2 backlog because it's not blocking now.)

---

### #11 — Auth & infra gaps deferred to later stages

Status: Tracked.

1. **Apple SSO** — provider commented out in `server/auth/config.ts`.
   Needs Apple Developer account + Services ID. Ship in Stage 11
   (notifications/polish) or sooner if user has account.
2. **`trustHost: true` is unconditional** in `server/auth/config.ts`.
   Needed for Vercel + dev. If we ever self-host on a non-trusted
   reverse proxy, scope it to dev + known prod hosts.
3. **No notification email on attorney activation** — admin clicks
   activate, attorney gets nothing until they next sign in. Fix:
   integrate Postmark in Stage 11.
4. **`signOut` server action has no test** — thin wrapper around
   Auth.js. Smoke-tested manually only.
5. **`<TRPCReactProvider>` wraps marketing pages** — see #10.3.

---

## Resolved

### #57 — Signed recommendation letter upload blocked in `draft_ready`

Resolved: 2026-05-09.

`canUploadInStatus` (`lib/case-status.ts`) used a single `UPLOADABLE_STATUSES`
list that ended at `needs_revision`, so attempting to upload a
recommender's signed PDF after the build threw `CONFLICT: uploads locked
while status is draft_ready`. The recommendation-letter workflow is
intrinsically post-build (build emits the template → recommender returns
signed PDF → attorney uploads), so the guard was wrong for that one
document type.

Fix: made the guard `documentType`-aware. New
`RECOMMENDATION_LETTER_UPLOAD_STATUSES` extends the base set with
`draft_ready`, `in_review`, `approved`. `package_ready` and beyond stay
closed because the package PDF is already compiled at that point and a
new letter would desync the bundle. `server/api/routers/document.ts:68`
forwards `input.documentType` through the guard. Regression tests
in `tests/unit/case-status.test.ts` lock the new boundaries.

### #53 — Migration journal was missing `0021_case_recommenders_rls` entry

Resolved: 2026-05-07.

The orphan file was renamed `0021_case_recommenders_rls.sql` →
`0025_case_recommenders_rls.sql` and a matching journal entry appended
(idx 24). `pnpm db:migrate` then ran the SQL — and the `drop ... if
exists` notices proved the policies and trigger had **never** been
applied to the local DB either, despite the file living in the repo
since Stage 11. RLS is now enabled on `case_recommenders` with both
the participant + admin policies and the `updated_at` trigger
installed (verified via `pg_policy` + `pg_trigger`).

Root cause: the file was hand-authored without `pnpm db:generate:custom
--name=...`, so the journal was never bumped — and drizzle's migrator
walks the journal, not the directory, so the file was a silent no-op.
Lesson logged below.

### #51 — Onboarding "signed contractor agreement" is a free-text filename (theater, not a signature)

Resolved: 2026-05-06 — Stage 03b shipped.

Replaced the free-text `agreementFilename` input with a real in-app
electronic-signature flow. The contractor agreement body is now
versioned in-repo (`server/auth/agreements/contractor-v1.md` +
`server/auth/contractor-agreement.ts`), with a sha256 hash recomputed
at module load and pinned via `z.literal` at the signing boundary.

A generic `signed_documents` table records every signature with
`document_kind`, `document_version`, `content_hash`, typed legal
name, IP, UA, and a path to the persisted PDF artifact (rendered
once at sign time, never regenerated). RLS is self-SELECT +
self-INSERT only; UPDATE/DELETE are admin-only by omission.

`attorney.submitOnboarding` now requires a `signatureId` and
re-validates ownership + kind + version + not revoked at submit
time. Onboarding is a server-decided two-step flow: Step 1
(`<SignAgreementStep>`) gates the Sign button on scroll-to-bottom +
typed name + ESIGN intent checkbox; Step 2 (`<OnboardingForm>`)
collects bar credentials and references the existing signature row.

The admin attorney detail page surfaces the signature with date,
version, typed name, sha256 prefix, IP, and a "Download signed PDF"
button that mints a fresh 5-minute signed URL on click. The
generic `signed_documents` table will be reused in Phase 2 for
applicant-side engagement letters and other one-sided agreements
without schema changes (the discriminator is text, not enum).

`attorney_profiles.agreement_storage_path` was dropped;
`agreement_signed_at` remains as a denormalized convenience flag
written from the signature row's `signed_at` at submission time.

See `build_stages/03b_contractor_signature.md` for the full
implementation record.

### #1 — Schema design gaps to settle before generating Stage 01 migration

Resolved: 2026-04-27 — "Apply revised plan."

Decisions:
1. ✅ Single `users` table satisfies Auth.js + business needs.
2. ✅ Partial unique index on `users.email` where `deleted_at is null`.
3. ✅ `citext` extension (custom SQL migration #2 below).
4. ✅ `bigint` for all `*_cents` columns.
5. ✅ RLS via `current_setting('app.current_user_id')` + `is_admin()` +
   `user_in_org()` / `user_in_case()` SECURITY DEFINER helpers.
6. ✅ Soft-deleted users excluded from RLS via `deleted_at is null`.
7. ✅ Versioned `case_outputs` (`output_version`, `is_current`, `pinned`,
   `row_revision`); pruning job in Stage 11.
8. ✅ `sha256 char(64) not null` on `case_documents` for dedup.
9. ✅ Status state machine enforced in Stage 05 service layer.
10. ✅ `case_events.event_type` is plain text + `lib/event-types.ts`.
11. ✅ `updated_at` trigger noise accepted; counter writes moved to
    `case_compute_ledger`.
12. ✅ Storage path stored as text; backend choice deferred to Stage 06.
13. ✅ Waitlist GDPR delete via manual SQL + audit log entry; Phase 2
    adds self-serve.
14. ✅ Replaced `cases.attorney_id`/`beneficiary_id` with
    `case_participants` junction.
15. ✅ `attorney_profiles.bar_states text[]`; GIN index when search lands.

Plus eight new considerations applied:
- ✅ A. `organizations` + `organization_members`.
- ✅ B. `row_revision` on `users`, `organizations`, `cases`, `case_outputs`.
- ✅ C. Hard-delete pathway documented (#3.10 above).
- ✅ D. `audit_log` (renamed); generic actor.
- ✅ E. `case_events` indexed by `(case_id, created_at)`.
- ✅ F. PII column comments via custom SQL migration.
- ✅ G. `users.timezone` + `users.locale`.
- ✅ H. Long-text in Postgres for now; threshold documented.
- ✅ I. Service-layer query context object — convention noted.
- ✅ J. `prepare: false` on postgres-js for transaction-pooler compat.

JSONB type drift between Drizzle and Zod — closed by linking Drizzle's
`.$type<>()` annotation to the Zod-inferred type in
`server/db/schema/zod/`. Single source of truth: Zod for blob shape,
Drizzle for column metadata.

### #2 — Custom SQL migrations to author

Resolved: 2026-04-29 — all 6 custom migrations authored + applied
(0001_extensions, 0002_citext_columns, 0003_updated_at_trigger,
0004_row_revision_trigger, 0005_rls, 0006_pii_comments, 0008_app_role).
Workflow + per-file rationale lives in `server/db/migrations/README.md`.

### #5 — `case_participants.role` (renamed to #7 above)

(Re-numbered to keep Active section sequential — see Active #7.)

### #6 — `sessions` table grows unbounded

Promoted to Phase-2 backlog #3.12 — not blocking until growth bites.

### `createCallerFactory` async-fn pattern

Resolved: 2026-04-30 — `tests/integration/trpc-server-caller.test.ts`
(3 tests) verifies the thunk pattern in `lib/trpc/server.ts` works
end-to-end through the real DB.
