# Architecture

> Phase 1 only. Phase 2 considerations are noted but not built.

## Layering

```
   ┌────────────────────────────────────────────────────────────┐
   │  Browser  (RSC + Client Components, no Supabase SDK)       │
   └────────────────────────┬───────────────────────────────────┘
                            │  fetch / Server Actions / tRPC
   ┌────────────────────────▼───────────────────────────────────┐
   │  Next.js (App Router, Turbopack)                           │
   │   • app/  — pages + route handlers                         │
   │   • proxy.ts — auth gate (Stage 02)                        │
   └────────────────────────┬───────────────────────────────────┘
                            │
   ┌────────────────────────▼───────────────────────────────────┐
   │  server/ (server-only)                                     │
   │   • api/        tRPC routers (Stage 02+)                   │
   │   • auth/       Auth.js handlers + Drizzle adapter         │
   │   • db/         Drizzle schema + client (postgres-js)      │
   │   • services/   external integrations                      │
   │   • jobs/       Inngest functions                          │
   └────────────────────────┬───────────────────────────────────┘
                            │
   ┌────────────────────────▼───────────────────────────────────┐
   │  Postgres (any host)         Inngest    Anthropic /        │
   │  via DATABASE_URL            (jobs)     Perplexity         │
   │                              Stripe     Postmark           │
   └────────────────────────────────────────────────────────────┘
```

## Module ownership

| Concern | Module | Notes |
|---|---|---|
| App identity, page routes, API paths, env | `config/` | Single source of truth; no hardcoded strings elsewhere |
| Cross-cutting utilities | `lib/utils.ts`, `lib/errors.ts` | `cn()`, `AppError` |
| Auth | `server/auth/` (Stage 02) | Auth.js v5 + Drizzle adapter; SSO only (Google/Apple/Microsoft) |
| Database | `server/db/` (Stage 01) | Drizzle on `DATABASE_URL`; Postgres-agnostic (Supabase/Neon/Railway/RDS) |
| Background jobs | `server/jobs/` (Stage 07) | Inngest |
| AI: drafting | `server/services/computer/` (Stage 07) | Perplexity Computer (primary) |
| Storage | `server/services/storage/` (Stage 06) | Decision pending — likely Supabase Storage or S3-compatible |
| Email | `server/services/email/` (Stage 11) | Postmark |
| Billing | `server/services/stripe/` (Stage 10) | Stripe Invoicing API |
| Analytics | `server/services/analytics/` + `lib/posthog.ts` (Stage 00b/04) | PostHog |
| Error tracking | Sentry (Stage 04+) | PII-redacted via `beforeSend` |

## Where to put new code

- A **page** the user visits → `app/(group)/.../page.tsx`. Add the path to `config/app.routes.ts`.
- A **server endpoint** (third party calls in) → `app/api/.../route.ts`. Add the path to `config/api.routes.ts`.
- A **typed RPC the browser calls** → tRPC procedure under `server/api/routers/` (Stage 02+). No new `/api/*` routes for this.
- A **third-party integration** → `server/services/<name>/`. One folder per external system; one responsibility per file.
- A **background job** (>1s, AI call, email) → `server/jobs/<name>.ts`. The HTTP request returns immediately with a job id.
- A **shared UI primitive** → `components/ui/<name>.tsx` (Stage 00c). Compose Radix + cva + `cn()`.
- A **domain composite** (cards, tables for a specific noun) → `components/<domain>/`.
- A **cross-cutting helper** → `lib/`. Server-only helpers go in `server/`.

## Phase 2 hooks

Schemas (Stage 01+) leave nullable forward refs where Phase 2 will attach (e.g. `cases.beneficiary_user_id` will FK to a real applicant user once consumers exist). Do not back-fill these into Phase 1 — keep the surface minimal but extension-friendly.

## Authorization & RLS — when each engages

The codebase uses **two layers of access control**. Both must be in place; either alone is insufficient.

1. **Application-layer authorization** (the gate). Every tRPC procedure and route handler validates that the caller is allowed to do the operation. This is the primary defense — RLS is the safety net that catches the bugs we miss.

2. **Row-level security** (defense in depth). Postgres policies (defined in `0005_rls.sql`) filter rows based on `current_setting('app.current_user_id')`. Engaged only when the connection role is `app_user` (or another non-bypass role). Bypassed when the connection role is the DB owner (`postgres`).

### Two connection roles, two contexts

| Context | Role | RLS engaged? | Used by |
|---|---|---|---|
| Per-request user query | `app_user` | **Yes** | tRPC mutations / queries originated by an authenticated user (Stage 02 wraps every request transaction with `set local role app_user; set local app.current_user_id = '<uuid>'`) |
| System / admin code | DB owner (`postgres`) | **No** (bypassed) | Inngest jobs, seed scripts, admin SQL, `audit_log` writes from `withAudit()` wrapper, anything not bound to a user request |

### Why both modes exist

- System code (a Computer job updating `case_compute_ledger`, an Inngest worker writing `case_events`) has no user context. Forcing it through RLS would require a synthetic "system user" row with broad permissions, which is itself a security smell. Owner-role-bypasses-RLS is the standard pattern.
- Per-request code MUST go through RLS so that a missed `where userId = ?` in the service layer doesn't leak data. The combination of `app_user` role + per-request GUC makes this automatic.

### What this means for new code

- Writing a tRPC procedure → it's per-request → goes through `app_user`. RLS protects it. App-layer auth gates it.
- Writing an Inngest job / cron / seed → it's system code → uses owner role. RLS bypassed. **Be especially careful with authorization here** because RLS won't catch mistakes.
- Writing the `withAudit()` wrapper (Stage 09) → owner role. Otherwise audit_log writes would fail under any non-admin user context.

This split is what `tests/integration/rls.test.ts` exercises — connecting via `app_user` and asserting that a forbidden cross-user read returns zero rows.

### JSONB columns + Zod

`cases.beneficiary_data`, `case_outputs.metadata`, `audit_log.details` and the other jsonb columns are typed in TypeScript via `.$type<>()` annotations (in `server/db/schema/cases.ts` etc.) that point at Zod-inferred types from `server/db/schema/zod/`. **Zod is the source of truth for blob shape** — change the Zod schema, the Drizzle row type updates with it. Always `.parse()` at the service-layer boundary; Postgres only checks that the value is valid JSON, not that it matches the schema.

For row-shape validation (full insert/select shapes on relational columns), Stage 02 will adopt `drizzle-zod` (`createInsertSchema(users)`) which derives Zod from Drizzle — eliminates drift on the relational side.
