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

Schemas (Stage 01+) leave nullable forward refs where Phase 2 will attach (e.g. `cases.beneficiary_id` will FK to `users` once consumers exist). Do not back-fill these into Phase 1 — keep the surface minimal but extension-friendly.
