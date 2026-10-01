# Database setup (Member 1: start here)

Five SQL files, applied in order. They are plain SQL with no extensions, so the Supabase SQL editor
is enough - the CLI is optional.

| Order | File | What it does |
| --- | --- | --- |
| 1 | `migrations/20261001120000_core_schema.sql` | Enums, 10 tables, indexes, `updated_at` triggers |
| 2 | `migrations/20261001120100_functions_and_views.sql` | ETA / search functions and 6 read views |
| 3 | `migrations/20261001120200_rls_policies.sql` | RLS policies, grants, `security_invoker` on views |
| 4 | `migrations/20261001130000_gps_freshness.sql` | Adds `gps_status` / `location_is_stale` / `elapsed_minutes` to the live views |
| 5 | `seed.sql` | Demo data (simulated - see `docs/ASSUMPTIONS.md`) |

Migrations 1-3 are already committed and may already be applied, so they are treated as immutable;
migration 4 is additive and safe to run on top. If you are setting up from scratch, just run all
five in order.

## Option A - Supabase SQL editor

Open each file, paste into the SQL editor, run, in the order above. The seed prints a row-count
summary when it finishes.

## Option B - Supabase CLI

```bash
supabase link --project-ref <your-project-ref>
supabase db push          # applies the three migrations
psql "$DATABASE_URL" -f supabase/seed.sql
```

`supabase db reset` against a local stack applies the migrations and `seed.sql` automatically.

## Re-seeding before the demo

`seed.sql` is idempotent - it truncates the demo tables and reloads them. All trip times are
generated relative to `now()`, so re-running it is how you refresh the "live" state: buses move back
to mid-route, the delayed bus is delayed again, and the upcoming departures are upcoming again.

Run it right before presenting.

> It truncates every table including `profiles`, so do not run it after real sign-ups exist.

## Optional: realtime

Not applied by the migrations, because it depends on how the frontend subscribes. To push live
location updates to the browser:

```sql
alter publication supabase_realtime add table public.bus_locations;
alter publication supabase_realtime add table public.trips;
```

Subscribe to `bus_locations` inserts and join against `v_active_trips` for the detail, or just
re-query `v_active_trips` on each event - with a 10-bus fleet that is cheap.

## Verifying the install

```sql
select * from public.v_fleet_overview;
```

Expect 10 buses, 4 trips in progress, 2 delayed trips, 2 offline buses, 4 active routes,
6 active alerts.

```sql
-- live map payload
select trip_code, route_code, registration_no, delay_minutes, is_delayed,
       progress_pct, next_stop_name, latitude, longitude
from public.v_active_trips;

-- next buses at Karsaz
select * from public.fn_stop_arrivals((select id from public.stops where code = 'ST-KSZ'), 5);

-- journey search: Saddar -> Tower (returns two options)
select route_code, direction, estimated_duration_min, distance_km, fare_pkr
from public.fn_search_routes(
  (select id from public.stops where code = 'ST-SDR'),
  (select id from public.stops where code = 'ST-TWR'));
```

## Automated check

`scripts/validate-db.mjs` applies all five SQL files to an in-process Postgres and asserts 91
invariants (row counts, route ordering, ETA monotonicity, GPS freshness, demo scenario coverage,
analytics derivability, view output, and the JSON dataset against the database):

```bash
npm i -D @electric-sql/pglite
node scripts/validate-db.mjs
```

Re-run it after changing any SQL file.

## JSON dataset

`data/karachi-demo-data.json` and `data/gps-scenarios.json` are **generated** from the SQL above,
so they cannot drift from it. Regenerate after editing the seed:

```bash
node scripts/export-demo-data.mjs
```

They are useful for mocking the frontend before Supabase is wired up, and for the GPS simulator.
Rows are keyed by natural key (stop code, route code, registration), and trip/alert times are
offsets in minutes from the export moment rather than absolute timestamps, so a consumer can rebase
them onto its own clock.

## Reference

- [`docs/database-plan.md`](../docs/database-plan.md) - per-table specification, P0/P1/P2, Supabase notes
- [`docs/domain-model.md`](../docs/domain-model.md) - relationships and the golden path
- [`docs/gps-data-design.md`](../docs/gps-data-design.md) - GPS storage decision and write path
- [`docs/eta-data-design.md`](../docs/eta-data-design.md) - deterministic ETA inputs and formula
- [`docs/demo-scenarios.md`](../docs/demo-scenarios.md) - the five demo states, search and analytics queries
- [`docs/DATA_MODEL.md`](../docs/DATA_MODEL.md) - ERD, query recipes, seed contents
- [`docs/ASSUMPTIONS.md`](../docs/ASSUMPTIONS.md) - what is simulated, modelling decisions, limitations
