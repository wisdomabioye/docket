# Docket — Architectural Overview

> A narrative tour of how the system fits together. Read top-to-bottom on day one, then keep around as a reference. For per-decision rationale see `docs/decisions.md`; for module ownership see `docs/architecture.md`; for build sequencing see `build_stages/README.md`.

---

## 1. What Docket actually is

Docket is a single-tenant-per-attorney web app that helps a U.S. immigration attorney prepare an O-1A or EB-1A petition packet end-to-end:

1. Attorney creates a case + records beneficiary intake.
2. Attorney uploads evidence (CV, awards, publications, letters).
3. Docket calls Perplexity Sonar to draft the five package outputs (personal statement, petition letter, recommendation-letter templates, exhibit index, evidence plan).
4. Attorney reviews + edits in a Tiptap editor, approves each output.
5. System renders a PDF package, attorney downloads, files with USCIS independently.
6. Attorney logs the case fee; Docket bills the 15% share via Stripe Invoicing on a monthly cycle.

The app is built so Phase 2 (consumer onboarding, payments, mobile) can extend it without rewriting Phase 1. Schema columns are forward-nullable; abstractions are interface-driven where Phase 2 will swap implementations.

---

## 2. The 30,000-foot diagram

```
                                    ┌────────────────────┐
                                    │  Attorney browser  │
                                    │  (RSC + Client)    │
                                    └─────────┬──────────┘
                                              │ HTTPS
                                              ▼
                ┌──────────────────────────────────────────────────────────┐
                │  Vercel — Next.js 16 App Router (serverless)             │
                │                                                          │
                │  proxy.ts ─── auth gate (Auth.js session cookie)         │
                │     │                                                    │
                │     ├─► app/(marketing)        ─ public pages            │
                │     ├─► app/(auth)             ─ SSO sign-in             │
                │     ├─► app/(app)              ─ attorney workspace      │
                │     ├─► app/(admin)            ─ admin tools             │
                │     ├─► app/api/trpc/[trpc]    ─ all typed RPC           │
                │     ├─► app/api/webhooks/*     ─ Stripe, Inngest         │
                │     └─► app/api/inngest/*      ─ job worker endpoint     │
                │                                                          │
                │  server/ (server-only — never bundled to client)         │
                │     api/        tRPC routers + procedure builders        │
                │     auth/       Auth.js v5 + Drizzle adapter             │
                │     db/         Drizzle schema + postgres-js client      │
                │     services/   external integrations (one per system)  │
                │     jobs/       Inngest functions (durable workflows)    │
                └──┬───────────┬──────────┬───────────┬──────────┬─────────┘
                   │           │          │           │          │
                   ▼           ▼          ▼           ▼          ▼
              ┌────────┐  ┌────────┐ ┌─────────┐ ┌────────┐ ┌─────────┐
              │Postgres│  │Inngest │ │Perplexity│ │Stripe │ │Postmark │
              │  +RLS  │  │ Cloud  │ │  Sonar   │ │       │ │(Stage11)│
              └────────┘  └───┬────┘ └─────────┘ └───┬────┘ └─────────┘
                              │ POST /api/inngest    │ POST /api/webhooks/stripe
                              └───── retries ────────┘ (signature-verified)
                                  ┌──────────────┐
                                  │ Upstash      │  rate limit + computer-health cache
                                  │ Redis (REST) │
                                  └──────────────┘
                                  ┌──────────────┐
                                  │ Supabase     │  signed URLs only; service role
                                  │ Storage      │  stays server-side
                                  └──────────────┘
```

Every box in the bottom row is **stateful infrastructure** that lives outside Vercel. The serverless runtime holds nothing — every invocation reads/writes durable state and exits. That's the consistent contract; the rest of this document is mostly "where does each kind of state live, and how does it get there."

---

## 3. The request lifecycle

### 3.1 A typical tRPC mutation (browser → DB)

```
Browser click
  │
  ▼
trpc.<router>.<procedure>.useMutation().mutate(input)
  │  superjson-encoded body, batched with concurrent calls via httpBatchLink
  ▼
POST /api/trpc/[trpc]?batch=1
  │  Next.js route handler runs in a fresh serverless invocation
  ▼
proxy.ts middleware
  │  reads Auth.js session cookie → looks up sessions row via the
  │  Drizzle adapter (database sessions, not JWTs) → attaches user.id
  ▼
server/api/trpc.ts createContext
  │  pulls user from session, opens a Drizzle transaction:
  │     SET LOCAL ROLE app_user;
  │     SET LOCAL app.current_user_id = '<uuid>';
  │  this is what engages RLS for this transaction
  ▼
procedure middleware
  │  protectedProcedure / attorneyProcedure / adminProcedure
  │  Zod parses input
  │  rate-limit check against Upstash Redis (per-user buckets)
  ▼
handler body
  │  uses ctx.db (RLS-engaged) for reads
  │  uses ownerDb (RLS-bypassed) only for bootstrap inserts that create
  │  the participant row RLS depends on
  ▼
response → superjson-encoded
  │
  ▼
React Query cache updated; UI re-renders
```

Two connection roles, two contexts:

| Caller                     | Role            | RLS  | Why                                                              |
|----------------------------|-----------------|------|------------------------------------------------------------------|
| tRPC procedure (per-user)  | `app_user`      | on   | Defense-in-depth; missed `where userId =` can't leak data        |
| Inngest job, seed, webhook | DB owner        | off  | No user context exists; would require a synthetic system user    |
| Bootstrap insert in tRPC   | DB owner        | off  | Inserting the first `case_participants` row can't satisfy RLS yet |

### 3.2 A typical RSC page render

Server Components are the default. A page like `/dashboard` calls `await api.<router>.<proc>()` which goes through the **server-side tRPC caller** (`lib/trpc/server.ts`) — same procedure code, same RLS context, no HTTP hop. The dashboard fetches `case.list`, `output.summarize`, `revenue.attorneySummary` in parallel and renders the HTML in one round-trip. Client components (`"use client"`) only appear where they have to: forms with local state (`RevenuePanel`), editors (`Tiptap`), interactive admin panels (`AdminInvoicePanel`).

---

## 4. The two big workflows

The interesting parts of the system are two long-running flows. Everything else is CRUD over Postgres.

### 4.1 Case build — the AI generation pipeline

Triggered when the attorney clicks "Generate" on `/case/[id]/build`. `case.requestBuild` returns immediately; the rest happens in Inngest.

```
attorney clicks Generate
  │
  ▼
case.requestBuild   (rate-limit: 10/hr/user)
  │  validates: documents complete, no in-flight build
  │  flips cases.status → 'building'
  │  inngest.send({ name: "case/build.requested", data: { caseId } })
  ▼  ────────────  Vercel function returns ✓ (200ms)  ────────────

       Inngest cloud receives the event, schedules the orchestrator

  ▼
case-build orchestrator (server/jobs/case-build.ts)
  │  step.run("load-context") → loadBuildContext(caseId)
  │     pulls beneficiary data, document text, prior outputs
  │  step.run("mark-building") → flips case status
  │
  │  step.invoke("invoke-evidence-plan", outputEvidencePlan)   ← sequential
  │     evidence plan is a dependency for the rest of the prompts
  │  step.run("reload-context") → re-fetches with the saved evidence plan
  │
  │  Promise.all over the parallel fan-out:
  │     • outputPersonalStatement
  │     • outputPetitionLetter
  │     • outputExhibitIndex
  │     • outputRecommendationLetter × N (one per recommender)
  │  partial-failure tolerant: each invoke is wrapped in .then(ok, err)
  │  so one failure doesn't sink the others
  │
  │  step.run("finalize-status") → marks build complete (success/partial/fail)
  │  emits "case/build.completed" or "case/build.failed"
  ▼
each child function (e.g. server/jobs/output-personal-statement.ts)
  │  step.run("compose-prompt") → assemble system + user messages
  │  step.run("call-perplexity") → wraps getComputerClient().generate()
  │     (this is the Perplexity Sonar HTTP call; can take 30-90s)
  │  step.run("save-output-version") → writes case_outputs row + audit
  │  emits "output/generated" event for any downstream consumers
  │
  │  on failure: caseBuildFailed.handleEvent flips revenue/build state,
  │  records the error, emits a notification event
  ▼
case-build-watchdog cron (every 5 min)
  │  scans for cases stuck in 'building' past their SLA
  │  marks them failed if Inngest lost a step or the function hung
```

**Why Inngest**: this whole pipeline is durable across serverless restarts. Each `step.run` is checkpointed in Inngest's store; if Vercel kills the function mid-step, Inngest re-POSTs and the SDK replays — already-completed steps return cached results, only the failed step re-executes. The function "spans hours" without any single invocation living more than ~2 minutes.

The Perplexity SDK call lives **inside** `step.run`. It's what the step does; Inngest's per-step execution budget is the real ceiling, not Vercel's function timeout. The SDK streams progress to Inngest while the HTTP call is in-flight, so the durable record is updated before any timeout.

### 4.2 Revenue & billing — the monthly invoice cycle

```
                  ── Attorney side ──────────────────────

case ships, attorney enters fee on /case/[id]
  │
  ▼
revenue.logCaseFee(feeCents)
  │  participant guard (must be primary attorney on the case)
  │  CONFLICT if revenue_status ∈ {invoiced, paid}
  │  computeRevenueSplit(fee) → 15/85, floor on docket side
  │  UPDATE cases SET case_fee_cents, docket_share_cents,
  │                   attorney_share_cents, revenue_status
  │  INSERT case_events → 'case.fee_logged'
  ▼
RevenuePanel shows the saved split; status pill flips to 'pending'

                  ── Admin side ─────────────────────────

admin opens /admin/revenue, picks attorney + period
  │
  ▼
revenue.eligibleCasesForPeriod (preview)
  │  filed-in-month + fee>0 + status ∈ {pending, failed}
  ▼
revenue.adminGenerateInvoice (wrapped in withAudit)
  │
  ▼
createMonthlyInvoice (server/services/stripe/index.ts)
  │  1. INSERT invoices row with placeholder stripe_invoice_id
  │  2. getOrCreateCustomer → Stripe Customer (lazy create)
  │  3. invoiceItems.create × N for each eligible case
  │     (line description = "{visa} · Beneficiary {initials}" — PII-safe)
  │  4. invoices.create + finalize + send
  │  5. UPDATE invoices SET stripe_invoice_id = real_id
  │  6. UPDATE cases SET revenue_status='invoiced', invoice_id=...
  │  on Stripe failure → DELETE the placeholder row; row reappears next try

                  ── Stripe side ─────────────────────────

Stripe finalizes invoice → emits invoice.paid (or .payment_failed/.voided)
  │
  ▼
POST /api/webhooks/stripe
  │  stripe-signature header verified via constructEvent
  │  → 400 on missing/invalid (Stripe retries)
  │  → 503 on missing STRIPE_WEBHOOK_SECRET
  ▼
dispatch by event.type → markInvoicePaid / Failed / Voided
  │  each is idempotent: SELECT ... FOR UPDATE, no-op if already in target state
  │  flips invoices.status AND cases.revenue_status atomically
  │  → 200 OK; on dispatch error returns 500 so Stripe retries
```

The whole flow is idempotent end-to-end:
- Generate is keyed by `(attorney, year, month)` — a duplicate click returns CONFLICT before touching Stripe.
- Webhook handlers no-op on duplicate state because Stripe legitimately delivers the same event id twice.
- The `withAudit` wrapper writes the `audit_log` row only on the success branch, so retries don't pile up phantom audit entries.

---

## 5. Identity, sessions, authorization

```
SSO provider (Google / Microsoft Entra ID — Apple is deferred to Stage 11)
  │  OAuth callback hits Auth.js handler
  ▼
server/auth/config.ts (Auth.js v5)
  │  Drizzle adapter persists accounts AND sessions in OUR Postgres
  │  (DATABASE_URL), not Supabase Auth. session.strategy = "database",
  │  not JWT. No email/password flow exists by design.
  ▼
opaque session cookie set
  │  proxy.ts intercepts every protected route, looks up the session
  │  via Auth.js → user.id is forwarded into tRPC ctx
  ▼
procedure-builder middleware
  │  protectedProcedure → throws UNAUTHORIZED if no user
  │  attorneyProcedure  → must have user_roles.role = 'attorney'
  │                       AND attorney_profiles.status = 'active'
  │  adminProcedure     → must have user_roles.role = 'admin'
```

**RLS engaged via per-request GUC:** before each request runs its handler, the transaction does `SET LOCAL app.current_user_id = '<uuid>'`. Postgres policies in `0005_rls.sql` reference `current_app_user()` which reads that GUC; the `app_user` Postgres role has no superuser bit, so it cannot bypass RLS. Test coverage in `tests/integration/rls.test.ts` connects as `app_user` and asserts cross-user reads return zero rows.

**withAudit pattern (Stage 9):** any admin write goes through `withAudit({ db, adminId, action, targetType, targetId, detailsFrom }, async () => { ... })`. The audit row writes inside the same transaction as the mutation; success is the only path that leaves an audit entry. Used by `admin.suspendAttorney`, `admin.activateAttorney`, `revenue.adjustCaseFee`, `revenue.adminGenerateInvoice`.

---

## 6. Data + state map

| Where it lives                               | What                                                                  |
|----------------------------------------------|-----------------------------------------------------------------------|
| Postgres (managed; `DATABASE_URL`)           | Everything relational — users, cases, documents, outputs, invoices, audit log, sessions, accounts, case_events, case_compute_ledger |
| Supabase Storage                             | Raw uploaded files; only signed URLs leave the server                 |
| Inngest cloud                                | Job state, step memoization, cron schedules, retry counters           |
| Upstash Redis (REST)                         | Rate-limit token buckets, computer-health snapshot cache              |
| Stripe                                       | Customers, invoices (line items, hosted URLs, payment status)         |
| Postmark                                     | Outbound transactional emails (Stage 11)                              |
| Sentry                                       | Errors with PII scrubbed at SDK `beforeSend`                          |
| PostHog                                      | Product analytics events (server SDK only)                            |
| Vercel                                       | Stateless function execution + static asset CDN                       |

The serverless function never holds in-memory state across requests. The only "process-local cache" is the `cached` Stripe singleton inside `getStripe()` and the Drizzle pg client — both rebuilt on cold start.

---

## 7. Background jobs and crons

Inngest is the only scheduler. Two cron-shaped functions today:

- **`computer-health`** — `*/5 * * * *`. Pings Perplexity, writes a snapshot to Redis, emits a `computer/health.degraded` event when latency or errors cross thresholds. Concurrency limit 1 (overlap = skip), retries 0 (next tick is the retry).
- **`case-build-watchdog`** — `*/5 * * * *`. Scans for cases stuck in `building` past a fixed stuck-threshold (`STUCK_THRESHOLD_MINUTES = 30`) and marks them failed; this catches the case where Inngest lost a step or a child function crashed silently.

Inngest fires each tick by POSTing to `/api/inngest`. Vercel spawns a serverless invocation, the SDK runs the function, returns. Vercel keeps nothing warm — the scheduler does.

Future crons will likely add: monthly auto-invoice generation, Stripe reconciliation sweep, stale-draft cleanup. All would land as new Inngest functions in `server/jobs/`, no infrastructure change.

---

## 8. Module boundaries — the rules that keep this honest

- **`server/` is server-only.** Anything imported from here must never reach the bundle. The `server-only` package guards key modules; the Stripe secret, Postmark token, Perplexity key, Supabase service role are referenced only inside `server/`.
- **One responsibility per module.** A tRPC router does input shape + auth + validation; queries belong in services or schema modules. A service touches one external system. A component renders UI; it doesn't fetch (use hooks or RSC).
- **Validate at the boundary.** Every external input — HTTP body, file upload, env var, third-party response — passes through Zod before entering business logic. Internal code trusts internal code.
- **Type safety end-to-end.** No `any`. Database row types come from Drizzle inference; API I/O comes from Zod; React props come from inference. Never hand-write a type that already exists upstream.
- **Money is integer cents (bigint columns).** Float arithmetic never touches a money value. The 15/85 split lives in exactly one place: `computeRevenueSplit`. Aggregates returned by `sql<bigint>` SQL fragments are coerced via `bn()` because postgres-js returns aggregate columns as strings.
- **JSONB columns are typed.** `cases.beneficiary_data`, `case_outputs.metadata`, `audit_log.details`: TypeScript shape comes from a Zod schema in `server/db/schema/zod/`; Drizzle's `.$type<>()` annotation references it. Always `.parse()` at the service boundary.
- **Soft delete, not hard.** Every business table has `deleted_at`; queries filter on `IS NULL`. Hard delete is admin-only and audited.
- **Forward-compatible schema.** Phase 2 columns are nullable today (`cases.beneficiary_user_id` for the future applicant FK; `cases.invoice_id` is also nullable since not every case becomes an invoice line). New tables get RLS in the same PR — gap caught during Stage 10 added `0014_invoices_rls.sql` retroactively.

---

## 9. Failure modes and how the system handles them

| Failure                                       | What protects us                                                                  |
|-----------------------------------------------|-----------------------------------------------------------------------------------|
| Vercel function timeout mid-build             | Inngest replay — completed steps cached, only the failing step retries            |
| Perplexity outage                             | `step.run` retries; `case-build-watchdog` flags cases stuck in `building` >30 min; failure event flips state |
| Stripe webhook delivered twice                | `markInvoice*` helpers no-op when already in target state (FOR UPDATE + status check) |
| Stripe webhook lost                           | Future reconciliation cron (planned); for now admin can manually re-fetch invoice |
| Concurrent edits to a case                   | `row_revision` optimistic concurrency token bumped by trigger; conflicting save returns CONFLICT |
| RLS GUC missing (app_user role with no user) | Every policy evaluates to false → all rows hidden, all writes denied               |
| Missing env var at boot                      | `config/env.ts` Zod parse fails fast; the function refuses to start               |
| PII in logs / errors                         | Sentry `beforeSend` strips known PII keys; Pino logger applies the same redact list |
| Bad input to a public endpoint               | Zod parse at the procedure boundary; rate-limit at Upstash; HMAC verify on webhooks |

---

## 10. The minimum env surface

Production needs all of these set. Most are typed `.optional()` in `config/env.ts` so dev / CI can run without them, but the app fails loud at the call site if it tries to use an unconfigured integration.

```
DATABASE_URL                # Postgres connection
AUTH_SECRET                 # Auth.js session encryption (≥32 chars)
AUTH_GOOGLE_ID/SECRET       # active provider today
AUTH_MICROSOFT_ID/SECRET    # active provider today
AUTH_APPLE_ID/SECRET        # env slot reserved; provider wires up in Stage 11
INNGEST_EVENT_KEY           # Inngest cloud event key
INNGEST_SIGNING_KEY         # webhook signature verification
PERPLEXITY_API_KEY          # Sonar
UPSTASH_REDIS_REST_URL      # rate limit + health cache
UPSTASH_REDIS_REST_TOKEN
STRIPE_SECRET_KEY           # Stage 10 (revenue logging works without; invoice generation doesn't)
STRIPE_WEBHOOK_SECRET
POSTMARK_API_KEY            # Stage 11
NEXT_PUBLIC_SENTRY_DSN      # error tracking
SENTRY_AUTH_TOKEN           # source-map upload
NEXT_PUBLIC_POSTHOG_KEY     # analytics
NEXT_PUBLIC_POSTHOG_HOST
```

---

## 11. Where to look when you need to change something

| You want to...                                  | Start at                                                          |
|-------------------------------------------------|-------------------------------------------------------------------|
| Add a new page                                  | `app/(group)/<path>/page.tsx`; register in `config/app.routes.ts` |
| Add a typed RPC                                 | New `server/api/routers/<domain>.ts`; mount in `server/api/root.ts` |
| Add a third-party integration                   | `server/services/<system>/`; one folder per system                |
| Add a background job                            | `server/jobs/<name>.ts`; export from `server/jobs/index.ts`       |
| Change the schema                               | `server/db/schema/<file>.ts`, then `pnpm db:generate`             |
| Add RLS for a new table                         | Hand-authored migration via `pnpm db:generate:custom`             |
| Add a new Auth.js provider                      | `server/auth/config.ts`; env vars in `config/env.ts`              |
| Add an admin action                             | `adminProcedure` + `withAudit` wrapper                            |
| Add a new analytics event                       | PostHog call site; centralize the event name in `lib/constants.ts` per CLAUDE.md §7 (event-names taxonomy lands when Stage 11 wires PostHog) |
| Add an invoice line shape                       | `server/services/stripe/split.ts` + `createMonthlyInvoice`         |
| Trace a failed background run                   | Inngest dashboard → run id → step trace; correlate via case_events |

---

## 12. Reading order for a new contributor

1. This file (`ARCHITECTURAL.md`).
2. `CLAUDE.md` (workspace root) — engineering rules, anti-patterns, locked stack.
3. `Docket_Technical_Spec_v2.md` — product spec.
4. `docs/decisions.md` — accumulated ADRs.
5. `docs/architecture.md` — module-ownership reference.
6. `build_stages/README.md` + the active stage file — current implementation contract.
7. `server/db/schema/` end-to-end — the data model is the system.
8. `server/api/routers/` end-to-end — every user-facing operation.
9. `server/jobs/` — the durable work.

Once those are loaded, the rest of the codebase reads itself.
