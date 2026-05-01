# Docket

AI-powered case prep for U.S. immigration attorneys (Phase 1).

> Plan, mockups, and orientation live in the parent repo: `../CLAUDE.md`,
> `../build_stages/`, `../Docket-Meridian-UI/hifi/`. Read those first.
> Engineering specifics for **this** Next.js app are in `docs/`.

## Stack

Next.js 16 (App Router, Turbopack default) · React 19.2 · TypeScript strict · Tailwind 4 · Auth.js (planned, Stage 02) · Drizzle (planned, Stage 01) · Postgres on `DATABASE_URL`.

## Setup

```bash
nvm use            # Node 22
pnpm install
cp .env.local.example .env.local   # fill in keys as stages activate them
pnpm dev           # http://localhost:3000
```

## Local dev — two terminals

Background work (build pipeline, watchdog, retries, etc.) runs through
Inngest. In dev, Inngest is a separate local CLI that brokers events
between this Next app and its job functions.

```bash
# Terminal 1 — Next.js
pnpm dev                 # http://localhost:3000

# Terminal 2 — Inngest (start AFTER pnpm dev so the discovery probe finds it)
pnpm inngest:dev         # http://localhost:8288 (event UI)
```

The Inngest CLI is pointed at this app's webhook endpoint via the `-u`
flag in `pnpm inngest:dev` (`/api/webhooks/inngest`, NOT the SDK's
default `/api/inngest`). It picks up events fired via `inngest.send(...)`
and invokes the matching job functions back through that endpoint.

If you see logs like `GET /login?callbackUrl=%2Fapi%2Finngest 200`
spamming Terminal 1, the CLI is probing the wrong path — check that
you're running `pnpm inngest:dev` (which carries the `-u` flag) and
not a bare `npx inngest-cli dev`.

**Without Terminal 2**, anything that goes through Inngest sits queued
forever — the most visible symptom is a case stuck at `building` (or
extraction never reconciling). If you see that, start the Inngest CLI
and the queued events will drain.

### Why the build can finish without a Perplexity key

`server/services/computer/factory.ts` checks `PERPLEXITY_API_KEY`. When
unset (the dev default), it returns `MockComputerClient` — a deterministic
stub that fabricates output and pricing in milliseconds. The full job
flow still runs (Inngest function → DB writes → state machine flips to
`draft_ready`); only the AI call is mocked.

Set `PERPLEXITY_API_KEY` in `.env.local` only when you want to exercise
the real Sonar API. Tests and most local dev should stay on the mock.

## Inngest: dev vs prod

The keys in `.env.local` (`INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY`)
are **production** credentials. Local dev does not consume them — the
`inngest-cli dev` server runs unauthenticated on `:8288` and the SDK
auto-detects it. You can leave the keys in `.env.local` for parity with
prod env files; they're inert until the app talks to Inngest Cloud.

In production:

- `INNGEST_EVENT_KEY` is sent on every `inngest.send(...)` so Inngest
  Cloud accepts the event as belonging to this app.
- `INNGEST_SIGNING_KEY` signs the webhooks Cloud delivers back to
  `/api/inngest`, so the endpoint can verify the request really came
  from Inngest and isn't an attacker invoking jobs directly.

Deployment flow: set both keys as Vercel (or host) environment vars,
deploy, then register the deployment URL with Inngest Cloud. After
that, `inngest.send` from prod talks to Cloud; Cloud invokes job
functions over HTTPS back to the deployed `/api/inngest`. No CLI runs
in prod — Cloud replaces it.

## Object storage: local vs Cloudflare R2

Default `STORAGE_BACKEND=local` writes uploaded documents and rendered
PDFs to `./storage/` — fine for `pnpm dev`. Vercel's serverless
filesystem is ephemeral, so any production deploy must switch to S3.

Cloudflare R2 is S3-API-compatible by design. The same
`@aws-sdk/client-s3` library Cloudflare itself recommends in their
docs talks to R2, AWS S3, MinIO, and Backblaze B2 — only the endpoint
URL changes. There is no separate "R2 SDK".

### One-time R2 setup

1. Cloudflare dashboard → R2 → **Create bucket** (`docket-files`).
2. **Manage R2 API Tokens** → Create token with **Object Read & Write**
   on that bucket. Save the Access Key ID + Secret Access Key.
3. Note the account-scoped endpoint:
   `https://<account-id>.r2.cloudflarestorage.com`.
4. Add to Vercel env (or `.env.local` for testing against R2 from your
   machine):

   ```bash
   STORAGE_BACKEND=s3
   S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
   S3_ACCESS_KEY_ID=<access-key-id>
   S3_SECRET_ACCESS_KEY=<secret-access-key>
   S3_BUCKET=docket-files
   S3_REGION=auto                  # R2 sentinel; AWS would be e.g. us-east-1
   ```

`config/env.ts` validates at boot — if `STORAGE_BACKEND=s3` and any
S3 var is missing, the process refuses to start with a flat list of
what's missing. No silent fall-through to ambient AWS credentials.

### Switching to AWS S3 (or MinIO / B2) instead

Same five vars, different endpoint + region. AWS S3: omit `S3_ENDPOINT`
and set `S3_REGION` to the bucket's region (the SDK will derive the
endpoint). MinIO / B2: use their endpoint, region usually `us-east-1`
or `auto`.

## Quality gates

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Layout

- `config/` — single source of truth for app metadata, page routes, API endpoints, validated env. **Never hardcode a path or env key — import from `@/config`.**
- `app/` — Next.js App Router. Route groups: `(marketing)`, `(auth)`, `(app)`, `(admin)`, `(dev)`.
- `components/` — `ui/` primitives + domain folders added stage by stage.
- `server/` — server-only code: `db/`, `api/` (tRPC, planned), `auth/`, `services/`, `jobs/`.
- `lib/` — cross-cutting helpers (`utils.ts` `cn()`, `errors.ts` `AppError`).
- `tests/unit/`, `tests/integration/` — Vitest.
- `docs/` — architecture + ADRs.

## Health check

```bash
curl -s http://localhost:3000/api/health | jq
```

Each integration field flips from `not_configured` to `connected` as its env var arrives in a later stage.
