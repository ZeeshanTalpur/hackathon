# Database setup (Member 1: start here)

Four SQL files, applied in order. They are plain SQL with no extensions, so the Supabase SQL editor
is enough - the CLI is optional.

| Order | File | What it does |
| --- | --- | --- |
| 1 | `migrations/20261001120000_core_schema.sql` | Enums, 10 tables, indexes, `updated_at` triggers |
| 2 | `migrations/20261001120100_functions_and_views.sql` | ETA / search functions and 6 read views |
| 3 | `migrations/20261001120200_rls_policies.sql` | RLS policies, grants, `security_invoker` on views |
| 4 | `seed.sql` | Demo data (simulated - see `docs/ASSUMPTIONS.md`) |

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

Expect 10 buses, 4 in progress, 1 delayed trip, 2 offline buses, 4 active alerts.

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

`scripts/validate-db.mjs` applies all four files to an in-process Postgres and asserts 54
invariants (row counts, route ordering, ETA monotonicity, scenario coverage, view output):

```bash
npm i -D @electric-sql/pglite
node scripts/validate-db.mjs
```

Re-run it after changing any SQL file.

## Reference

- [`docs/DATA_MODEL.md`](../docs/DATA_MODEL.md) - ERD, table reference, ETA formula, query recipes
- [`docs/ASSUMPTIONS.md`](../docs/ASSUMPTIONS.md) - what is simulated, modelling decisions, limitations
