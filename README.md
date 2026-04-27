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
