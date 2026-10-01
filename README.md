# Karachi Transit — Smart Public Transport & Bus Tracking

> **DEMO / SIMULATED HACKATHON DATA.** Routes, schedules, buses, fares, timings,
> capacities and driver records in this repository are invented for a hackathon
> demonstration. They are **not** official Karachi public transport information.
> Stop coordinates reference real Karachi locations so they render correctly on a
> map, but no route or timetable here is verified against any transport authority.

Next.js 16 + TypeScript + Tailwind CSS v4, backed by Supabase (PostgreSQL, Auth,
Realtime). Google Maps is the intended map layer.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run dev
```

`GET /api/health` reports exactly which piece of the wiring is missing, so start
there if something looks wrong.

### Supabase

Requires a Supabase project. Apply migrations in filename order, then the seed:

```bash
supabase link --project-ref <ref>
supabase db push                              # supabase/migrations/*.sql
psql "$DATABASE_URL" -f supabase/seed.sql     # or paste into the SQL editor
node scripts/seed-auth.mjs                    # 4 demo auth users
```

`supabase/seed.sql` truncates and reloads the demo tables, so it is safe to
re-run; it also regenerates timestamps relative to `now()`, which refreshes the
"live" demo state.

### Demo accounts

Created by `scripts/seed-auth.mjs`, one per role, password `demo-transit-2026`:
`passenger@karachitransit.demo`, `driver@karachitransit.demo`,
`operator@karachitransit.demo`, `admin@karachitransit.demo`.

## Validation

```bash
npm run typecheck
npm run lint
npm run build
node scripts/validate-db.mjs    # applies all SQL to an in-process Postgres (PGlite)
```

`validate-db.mjs` needs no Supabase project, Docker or `psql`: it runs every
migration and the seed against PGlite and asserts schema and data invariants.

## Layout

| Path | Contents |
| --- | --- |
| `supabase/migrations/` | Schema, functions/views, RLS, GPS freshness, auth/realtime |
| `supabase/seed.sql` | Karachi demo dataset |
| `data/` | Same dataset as JSON, generated from the SQL by `scripts/export-demo-data.mjs` |
| `docs/` | Database plan, domain model, ETA and GPS design, demo scenarios |
| `src/lib/supabase/` | Browser, server and service-role clients |
| `src/lib/auth.ts` | Session + role helpers (server-only) |
| `src/proxy.ts` | Session refresh (Next.js 16 replaces `middleware.ts` with `proxy.ts`) |

## Secrets

`SUPABASE_SERVICE_ROLE_KEY` bypasses RLS and must never reach the browser. It has
no `NEXT_PUBLIC_` prefix and is only read by `src/lib/supabase/admin.ts`, which
is marked `server-only` so an accidental client import fails the build. Only
`.env.example` is committed; `.gitignore` excludes every other `.env*` file.
