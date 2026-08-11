# CLAUDE.md — Analytics Spec Generator

Internal Tripledot Studios tool, branded **Cerberus Analytics Hub**. This is a self-contained Next.js app with its own git repo (`origin: cerberus-analytics-spec-generator`, deployed to Vercel). Nearly all development happens here.

For the wider workspace (the Excel → JSON reference-library pipeline, design mockups, Snowflake SQL), see the `CLAUDE.md` one directory up.

## What it does

Three products in one app:

1. **Spec Generator** (`/`, `components/MvpApp.tsx`) — Given a structured intake describing a mobile game (genre, core loop, economy, IAP, ads, live ops…), it generates an analytics tracking spec (events + payload fields + platform ad payloads) by matching against a curated reference library. Users review/edit events, save, import (XLSX/CSV), and export (JSON/XLSX).
2. **Tech Launch Readiness** (`/tech-launch`, `components/TechLaunchDashboard.tsx`) — Runs telemetry SQL via the Count.co API (over Snowflake) for a fixed roster of Tripledot games, producing red/yellow/green launch-readiness verdicts. Results are cached.
3. **Spec Check** (`/spec-check`, `components/SpecCheckDashboard.tsx`) — Pulls live event data from Snowflake (via Count) for a dev app/version and compares it against a **saved spec**: event/payload name typos (normalized match + Levenshtein), missing vs untracked items, data-type checks for numeric/boolean payloads, and enum-value typo/coverage checks for `item`, `source`, `item_type`, `placement`. Verdict: pass / warnings / fail / no data.

## Stack

- **Next.js 15** (App Router), **React 19**, **TypeScript** (strict), ESM (`"type": "module"`).
- **Tailwind 3** — custom dark "Vector Pro" theme in `tailwind.config.ts` (primary cobalt `#0066ff`; fonts Inter / Hanken Grotesk / JetBrains Mono). Global CSS in `app/globals.css`.
- **NextAuth v5** (Auth.js), Google provider only.
- **Postgres** in production; local dev falls back to a **SQLite file** (`data/analytics.sqlite`) via the `sqlite3` **CLI**. Drizzle ORM is used **only for schema definitions** (`lib/schema.ts`) — actual queries in `lib/db.ts` are hand-written SQL.
- **Zod** for all validation. **Vitest** (unit/integration) + **Playwright** (e2e).

## Commands

```bash
npm run dev        # dev server, http://localhost:3000
npm run build      # production build
npm start          # serve production build
npm run lint       # next lint
npm test           # vitest run (unit/integration; excludes tests/e2e)
npm run test:ui    # playwright (e2e); boots dev server on 127.0.0.1:3100
```

## Architecture map

| Concern | Location |
| --- | --- |
| Domain models & Zod schemas | `lib/types.ts` |
| Rule-based spec generation | `lib/generator.ts` — `selectFeaturePacks`, `generateSpecFromRules` (deterministic keyword matching); optional `enhanceSpecWithAi` |
| Field-name canonicalization | `lib/canonical.ts` |
| Data access (Postgres + SQLite fallback, library snapshot, tech-launch cache) | `lib/db.ts` |
| Auth — NextAuth config (Google, `@tripledotstudios.com` gate) | root `auth.ts` + `lib/auth-policy.ts` |
| Auth — app user resolution + RBAC | `lib/auth.ts` (`getCurrentAppUser`, `requireCurrentAppUser`, `assertCanCreateSpec`, `assertCanMutateSpec`, `jsonError`) |
| Import / export | `lib/import-spec.ts`, `lib/export.ts` |
| Tech-launch logic | `lib/tech-launch.ts` + `lib/count-api.ts` (Count.co API over Snowflake); SQL template `data/tech_launch_telemetry_metrics.sql` |
| Spec-check logic | `lib/spec-check.ts` (SQL builder, audit CSV parser, comparison engine, cache/poll flow); SQL template `data/events_audit.sql`. Reuses the tech-launch cache table with `spec-check:`-prefixed keys; cache key includes the spec's `updatedAt` + built-SQL hash. The SQL's enum-field filter is extended per-spec (field names whose `canonicalFieldName` is enum-like, e.g. `type`→`source`), and enum values are aggregated in SQL to stay under Count's 1000-row preview cap |
| Reference library seed | `data/analytics_reference_library.json` (copied from the workspace pipeline) |
| UI | `components/MvpApp.tsx` (~3,000 lines), `components/TechLaunchDashboard.tsx` (~1,100 lines), `components/SpecCheckDashboard.tsx` (~1,100 lines) — nearly all UI logic lives in these client components |

### API routes (`app/api/**`)

- `auth/[...nextauth]` — NextAuth handlers.
- `me` — current app user + auth status.
- `generate` — POST intake → generated spec (rules + optional AI). Requires create permission.
- `library` — GET reference library snapshot (unauthenticated).
- `specs` — GET list saved specs; POST save spec.
- `specs/[id]` — GET (unauthenticated read), PUT update, DELETE.
- `specs/import` — POST multipart XLSX/CSV → parse + save.
- `export/json`, `export/xlsx` — POST spec → downloadable file (no auth check).
- `users` — GET all users (admin only); `users/[id]` — PATCH role (admin only).
- `tech-launch/app-versions` — available app versions.
- `tech-launch/readiness` + `tech-launch/readiness/status` — kick off / poll readiness job.
- `tech-launch/level-fail-rate` — level-by-level unique-player fail-rate series and breach status.
- `tech-launch/gameplay-alert-settings` — read global gameplay thresholds; admins can update them.
- `cron/gameplay-alerts` — protected daily evaluator for gameplay alert state and Slack transitions.
- `spec-check` + `spec-check/status` — kick off / poll a spec-vs-live-data check (submit-then-poll like tech-launch).
- `spec-check/app-versions` — app versions observed in the Ludios events union table.

Route handlers set `export const runtime = "nodejs"` when they touch `postgres`, the `sqlite3` CLI, or `fs`.

## Auth & RBAC

- Access is gated to **`@tripledotstudios.com`** Google accounts (`isAllowedAuthEmail`).
- Roles: **admin / editor / viewer**. Initial role from `ADMIN_EMAILS` / `EDITOR_EMAILS` env allowlists (default `viewer`); role only ever escalates on sync.
- Permissions: create spec = admin/editor; manage users = admin; mutate spec = admin (any) or editor (own specs only, by `ownerUserId`).

## Local dev & gotchas

- **`sqlite3` CLI must be installed** for local dev without Postgres — `lib/db.ts` shells out to it.
- **Test auth impersonation:** tests set `x-test-user-id` / `x-test-user-email` / `x-test-user-name` / `x-test-user-role` headers. Only honored when `AUTH_*` env vars are absent and not in production.
- **Path alias:** `@/` → repo root.
- **`next.config.ts`** bundles the tech-launch SQL via `outputFileTracingIncludes`; update it if that SQL path moves.
- **Stale config:** `.env.local` still contains Clerk keys — dead config; auth is fully NextAuth/Google now.
- The **AI enhancement (`enhanceSpecWithAi`) targets OpenAI** (`gpt-4.1-mini`, `https://api.openai.com/v1/responses`) and is a no-op without `OPENAI_API_KEY`. A likely future migration task is pointing this at Claude/Anthropic.

### Environment variables

Set in Vercel (not all present in `.env.local`):

- **Auth:** `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `ADMIN_EMAILS`, `EDITOR_EMAILS`, `AUTH_LOCAL_ADMIN`.
- **DB:** `DATABASE_URL` / `POSTGRES_URL` / `POSTGRES_PRISMA_URL` / `POSTGRES_URL_NON_POOLING` (any one; absent → local SQLite).
- **AI:** `OPENAI_API_KEY`, `OPENAI_MODEL`.
- **Count / Snowflake:** `COUNT_API_KEY`, `COUNT_PROJECT_KEY`, `COUNT_CONNECTION_KEY`, `COUNT_QUERY_TIMEOUT_MS`, `COUNT_API_BASE_URL` (default `https://api.eu.count.co`); `SNOWFLAKE_*`.
- **Caching:** `TECH_LAUNCH_CACHE_TTL_SECONDS` (default 900), `TECH_LAUNCH_APP_VERSION_CACHE_TTL_SECONDS` (default 3600), `SPEC_CHECK_CACHE_TTL_SECONDS` (default 900), `SPEC_CHECK_APP_VERSION_CACHE_TTL_SECONDS` (default 3600).
- **Gameplay alerts:** `CRON_SECRET` (authorizes the protected alert endpoint) and `SLACK_GAMEPLAY_ALERT_WEBHOOK_URL` (primary incoming webhook). Optionally set `SLACK_GAMEPLAY_ALERT_ADDITIONAL_WEBHOOK_URL` to mirror the same alerts to a second Slack channel. The daily scheduler is Vercel Cron, configured in `vercel.json`. It invokes the endpoint every five minutes around the Melbourne 08:30 delivery window so the asynchronous Count job can be submitted and then collected. Vercel supplies the `CRON_SECRET` authorization header automatically; no GitHub Actions secrets are required.

## Conventions

- One Zod schema per domain model in `lib/types.ts`; infer TS types from it (`z.infer`).
- Normalize thrown errors through `jsonError`; throw a `Response` (401/403) from RBAC helpers.
- Persistence code must handle **both** the Postgres and SQLite paths in `lib/db.ts` (see existing functions for the pattern) — they use hand-written SQL, not Drizzle queries.
- Match the surrounding style in the large components rather than restructuring them as part of unrelated changes.

## Tests

`tests/` (Vitest): `auth.test.ts`, `generator.test.ts`, `import-spec.test.ts`, `rbac-api.test.ts`, `tech-launch*.test.ts`, `spec-check-*.test.ts` (sql / parse / compare / cache / api), fixtures in `tests/fixtures/` + `tests/helpers/spec-check-fixtures.ts`. `tests/e2e/` (Playwright): `mvp.spec.ts`, `review-focus.spec.ts`.
