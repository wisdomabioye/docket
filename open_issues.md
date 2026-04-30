# Open issues

Tracker for design questions and known gaps. Three sections:

- **Active** — needs decision or action soon (blocks current/next stage)
- **Phase-2 backlog** — known limitations to revisit when scale demands them
- **Resolved** — decisions captured for posterity

When a gap is identified but not fixed in the same response, it goes here.
"Concerns mentioned in chat" are not enough — add an entry.

---

## Active

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
