# Database plan

> **DEMO / SIMULATED HACKATHON DATA.** The schema is real; the dataset loaded by
> `supabase/seed.sql` is invented. See [ASSUMPTIONS.md](./ASSUMPTIONS.md).

This is the authoritative per-table specification. For query recipes and the ERD see
[DATA_MODEL.md](./DATA_MODEL.md); for relationships and the golden path see
[domain-model.md](./domain-model.md).

## Architectural inputs

Member 1's architecture is **not documented in this repository** (see "Unresolved" at the end of
this file). The only architectural facts the repo proves are the frontend stack: Next.js 16.3.8,
React 19, TypeScript, Tailwind v4, App Router, `src/` directory, `@/*` import alias. Supabase /
PostgreSQL comes from the project brief. The database is therefore designed to be consumed either
by `supabase-js` from the browser or by Next.js server code, and makes no assumption beyond that.

## Why ten tables and not fewer

| Table | Kept because | Could it be dropped? |
| --- | --- | --- |
| `stops` | Every search, map marker and ETA needs a located stop | No |
| `routes` | The unit a passenger searches for and an operator manages | No |
| `route_stops` | Ordering is the whole point - without it there is no "next stop" or progress | No |
| `buses` | The tracked asset | No |
| `trips` | The unit of live tracking and the only durable record for analytics | No |
| `bus_locations` | GPS history; also the last-known fix for a parked bus | No |
| `profiles` | Four roles must be distinguishable | Not if there is any login |
| `drivers` | Driver is an operational record distinct from a login | Could fold into `profiles`, but then operators cannot manage a driver who has never signed in |
| `service_alerts` | Explicitly required for passengers and operators | No |
| `trip_stop_times` | Per-stop scheduled vs actual, which is what makes route performance analysable | **Yes** - see P2 below |

Things deliberately **not** created: a permissions table (role enum on `profiles` is enough), a
separate route-shape/geometry table (routes are drawn through their stops), a vehicle-assignment
history table, a fares/zones table, a notifications table, and any analytics rollup tables.

## Tables

Conventions: `id uuid primary key default gen_random_uuid()` everywhere except `bus_locations`,
which uses `bigint generated always as identity` because it is high-volume append-only.
All timestamps are `timestamptz`. "Required" means `not null`.

### profiles

Application users across all four roles.

| Column | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | uuid | yes | PK |
| `auth_user_id` | uuid | no | Unique. Links to `auth.users(id)`. Intentionally **not** a FK - see below |
| `full_name` | text | yes | |
| `email` | text | no | Unique |
| `phone` | text | no | Sensitive |
| `role` | `user_role` | yes | `passenger` \| `driver` \| `operator` \| `admin`, default `passenger` |
| `created_at` / `updated_at` | timestamptz | yes | `updated_at` maintained by trigger |

`auth_user_id` is nullable and unenforced so the seed can create demo users without creating
Supabase auth accounts. A real sign-up writes its own `auth.uid()` into the column. Add the foreign
key later if the referential guarantee is wanted.

Index: `profiles_role_idx (role)`.

### drivers

Operational driver record, separate from the login so an operator can manage a driver who has never
signed in.

| Column | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | uuid | yes | PK |
| `profile_id` | uuid | no | FK -> `profiles(id)` `on delete set null`, unique |
| `full_name` | text | yes | |
| `license_no` | text | yes | Unique, natural key. Sensitive |
| `phone` | text | no | Sensitive |
| `status` | `driver_status` | yes | `active` \| `off_duty` \| `on_leave`, default `off_duty` |
| `rating` | numeric(2,1) | no | `check (rating between 0 and 5)` |

Index: `drivers_status_idx (status)`.

### buses

| Column | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | uuid | yes | PK |
| `registration_no` | text | yes | Unique, natural key |
| `label` | text | no | Friendly name for the UI |
| `model` | text | no | |
| `capacity` | integer | yes | Default 45, `check (capacity > 0)` |
| `has_ac` | boolean | yes | Default false |
| `status` | `bus_status` | yes | `active` \| `idle` \| `maintenance` \| `offline`, default `offline` |
| `assigned_driver_id` | uuid | no | FK -> `drivers(id)` `on delete set null` |

`status` is the **vehicle** state, independent of `trips.status` (the service state). A bus can be
`offline` with no trip at all, which is how an untracked vehicle is represented.

Index: `buses_status_idx (status)`.

### routes

| Column | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | uuid | yes | PK |
| `code` | text | yes | Unique, natural key (`KHI-D1`) |
| `name` | text | yes | |
| `description` | text | no | |
| `color` | text | yes | `check (color ~ '^#[0-9A-Fa-f]{6}$')` so the map can use it directly |
| `distance_km` | numeric(6,2) | yes | `> 0`. Must equal the last stop's `distance_from_start_km` |
| `avg_speed_kmh` | numeric(5,2) | yes | Planning speed; the ETA fallback when GPS speed is 0 |
| `expected_duration_min` | integer | yes | `> 0`. Must equal the last stop's `scheduled_offset_min` |
| `fare_pkr` | numeric(7,2) | yes | Flat per route |
| `headway_min` | integer | yes | Default 20 |
| `first_departure` / `last_departure` | time | no | Service window |
| `is_active` | boolean | yes | **This is the route status.** `false` = suspended/withdrawn |

`is_active` is a boolean rather than an enum because two states are all the demo needs; promote it
to a `route_status` enum only if a third state becomes necessary. `fn_search_routes` filters on it,
so a suspended route disappears from passenger search automatically.

### stops

| Column | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | uuid | yes | PK |
| `code` | text | yes | Unique, natural key (`ST-SDR`) |
| `name` | text | yes | |
| `area` | text | no | Locality, useful for search grouping |
| `latitude` | numeric(9,6) | yes | `check (between -90 and 90)` |
| `longitude` | numeric(9,6) | yes | `check (between -180 and 180)` |
| `is_active` | boolean | yes | Default true |

`numeric(9,6)` gives ~0.1 m precision and avoids float drift in equality checks. Index:
`stops_lat_lon_idx (latitude, longitude)`.

### route_stops

The ordering table. This is the most constraint-heavy table in the schema because almost every
downstream calculation trusts it.

| Column | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | uuid | yes | PK |
| `route_id` | uuid | yes | FK -> `routes(id)` `on delete cascade` |
| `stop_id` | uuid | yes | FK -> `stops(id)` `on delete restrict` |
| `direction` | `trip_direction` | yes | `outbound` \| `inbound` |
| `stop_order` | integer | yes | `> 0`, 1-based position |
| `distance_from_start_km` | numeric(6,2) | yes | `>= 0`. Drives distance-based ETA and position interpolation |
| `scheduled_offset_min` | integer | yes | `>= 0`. Minutes after trip start - the timetable |
| `is_major_stop` | boolean | yes | Lets the UI show a condensed route |

Constraints: `unique (route_id, direction, stop_order)` and `unique (route_id, direction, stop_id)`.
The first stops two stops occupying one position; the second stops a route visiting the same stop
twice per direction.

`on delete restrict` on `stop_id` is deliberate: deleting a stop that a route uses should fail
loudly, not silently break a route.

Storing the timetable as an **offset** rather than an absolute time means one route definition
serves every departure of the day.

Indexes: `route_stops_route_dir_order_idx (route_id, direction, stop_order)` for walking a route,
`route_stops_stop_idx (stop_id)` for "which routes serve this stop".

### trips

One bus running one route in one direction at one departure time. The central operational table.

| Column | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | uuid | yes | PK |
| `trip_code` | text | yes | Unique, natural key |
| `route_id` | uuid | yes | FK -> `routes(id)` `on delete cascade` |
| `bus_id` | uuid | yes | FK -> `buses(id)` `on delete restrict` |
| `driver_id` | uuid | no | FK -> `drivers(id)` `on delete set null` - history survives a driver record being removed |
| `direction` | `trip_direction` | yes | |
| `service_date` | date | yes | Local departure date, for daily grouping |
| `scheduled_start_at` | timestamptz | yes | Timetable anchor for every per-stop scheduled time |
| `scheduled_end_at` | timestamptz | yes | `check (> scheduled_start_at)` |
| `actual_start_at` | timestamptz | no | Set when the driver starts the trip |
| `actual_end_at` | timestamptz | no | Set when the trip completes. Duration analytics need both |
| `status` | `trip_status` | yes | `scheduled` \| `in_progress` \| `completed` \| `cancelled` |
| `delay_minutes` | integer | yes | Signed: positive late, negative early. Default 0 |
| `progress_km` | numeric(6,2) | yes | `>= 0`. Distance covered from the route origin |
| `last_stop_order` | integer | no | `>= 0`. Derived from `progress_km` |
| `next_stop_id` | uuid | no | FK -> `stops(id)` `on delete set null`. Derived from `progress_km` |
| `occupancy` | integer | yes | `>= 0`. Manually reported in the demo |
| `notes` | text | no | Driver problem reports |

Delay is a signed number, **not** a status, so a trip can be in progress and late simultaneously.
The "delayed" threshold (`>= 5` minutes) lives in the views, in one place.

`progress_km` is the single source of truth for position. `last_stop_order` and `next_stop_id` are
caches of it, derived with SQL rather than maintained by hand, so they cannot disagree.

Indexes: `trips_status_idx (status)`, `trips_route_idx (route_id, service_date)`,
`trips_bus_idx (bus_id, service_date)`.

### bus_locations

Append-only GPS history. Named for the bus rather than the trip because a parked bus still has a
last-known position.

| Column | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | bigint identity | yes | PK |
| `bus_id` | uuid | yes | FK -> `buses(id)` `on delete cascade` |
| `trip_id` | uuid | no | FK -> `trips(id)` `on delete set null`. Null when the bus is not on a trip |
| `recorded_at` | timestamptz | yes | Default `now()`. Drives the staleness signal |
| `latitude` / `longitude` | numeric(9,6) | yes | Range-checked |
| `speed_kmh` | numeric(5,2) | yes | `>= 0`. Default 0 |
| `heading_deg` | numeric(5,2) | no | `check (>= 0 and < 360)` |
| `progress_km` | numeric(6,2) | no | Snapshot of route progress at this fix |
| `source` | text | yes | `check in ('simulated','device','manual')`. Distinguishes the demo simulator from real browser geolocation |

Indexes: `bus_locations_bus_recorded_idx (bus_id, recorded_at desc)` - this is the index that makes
"latest fix per bus" fast - and `bus_locations_trip_recorded_idx (trip_id, recorded_at desc)` for
replaying one trip's trail.

### trip_stop_times

Per-stop timetable for one trip: scheduled, estimated and actual arrival.

| Column | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | uuid | yes | PK |
| `trip_id` | uuid | yes | FK -> `trips(id)` `on delete cascade` |
| `route_stop_id` | uuid | yes | FK -> `route_stops(id)` `on delete cascade` |
| `stop_id` | uuid | yes | FK -> `stops(id)` `on delete restrict`. Denormalised from `route_stops` to keep passenger queries to one join |
| `stop_order` | integer | yes | Also denormalised, for cheap ordering |
| `scheduled_arrival_at` | timestamptz | yes | |
| `estimated_arrival_at` | timestamptz | no | Snapshot; the live estimate comes from `v_trip_stop_eta` |
| `actual_arrival_at` | timestamptz | no | |
| `status` | `stop_arrival_status` | yes | `pending` \| `arrived` \| `skipped` |

Constraint: `unique (trip_id, route_stop_id)`. Indexes:
`trip_stop_times_trip_order_idx (trip_id, stop_order)`, `trip_stop_times_stop_idx (stop_id)`.

This table carries the two denormalised columns in the schema. The duplication is deliberate and
bounded, and documented here so it is not mistaken for an accident.

### service_alerts

| Column | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | uuid | yes | PK |
| `title` / `message` | text | yes | |
| `severity` | `alert_severity` | yes | `info` \| `warning` \| `critical` |
| `route_id` / `bus_id` / `stop_id` | uuid | no | All optional FKs `on delete cascade`, so an alert can be network-wide or narrowly scoped |
| `starts_at` | timestamptz | yes | Default `now()` |
| `ends_at` | timestamptz | no | `check (ends_at is null or ends_at > starts_at)` |
| `is_active` | boolean | yes | Default true |

There is no `trip_id`. Alerts are about services and vehicles, which outlive a single trip; scoping
to a bus or route covers every case in the brief. Index:
`service_alerts_active_idx (is_active, starts_at desc)`.

## Enums

| Enum | Values | Used by |
| --- | --- | --- |
| `user_role` | `passenger`, `driver`, `operator`, `admin` | `profiles.role` |
| `driver_status` | `active`, `off_duty`, `on_leave` | `drivers.status` |
| `bus_status` | `active`, `idle`, `maintenance`, `offline` | `buses.status` |
| `trip_status` | `scheduled`, `in_progress`, `completed`, `cancelled` | `trips.status` |
| `trip_direction` | `outbound`, `inbound` | `route_stops`, `trips` |
| `stop_arrival_status` | `pending`, `arrived`, `skipped` | `trip_stop_times.status` |
| `alert_severity` | `info`, `warning`, `critical` | `service_alerts.severity` |

Postgres enums are cheap and self-documenting in the Supabase UI. The cost is that adding a value
needs `alter type`; that is an acceptable trade for a fixed vocabulary.

## P0 / P1 / P2

### P0 - the golden path does not work without these

`stops`, `routes`, `route_stops`, `buses`, `trips`, `bus_locations`, plus the views
`v_active_trips`, `v_trip_stop_eta`, `v_bus_latest_location` and the functions
`fn_search_routes`, `fn_route_point_at_km`.

With only these you can demo: search a journey, find a route, find a live bus, see it move, see an
ETA, and watch the trip complete.

### P1 - needed for the role-based demo

`profiles` (login and role gating), `drivers` (driver app and operator assignment),
`service_alerts` (passenger and operator announcements), plus `v_fleet_status` and
`v_fleet_overview` for operator monitoring.

### P2 - keep if there is time, cut if there is not

`trip_stop_times` and `v_route_summary`.

`trip_stop_times` is fully severable: **no view or function in the schema reads it.** The live ETA
is computed from `route_stops` and `trips` alone. If the table becomes a maintenance burden, stop
populating it; `drop table public.trip_stop_times;` breaks nothing else. The cost of dropping it is
losing scheduled-vs-actual per-stop analytics (route performance by segment).

## Supabase considerations

### Row level security

Enabled on all ten tables. Policies are deliberately thin:

- **Public read** (`anon`, `authenticated`) on `routes`, `stops`, `route_stops`, `buses`, `trips`,
  `bus_locations`, `trip_stop_times`, `service_alerts`. The passenger app must work logged out.
- **`profiles`**: a user sees and edits only their own row; operators and admins see all, via a
  `security definer` helper `fn_is_staff()` that reads `profiles` without recursing into its own
  policy.
- **`drivers`**: authenticated only, because the rows carry phone and licence numbers.
- **Writes** on reference tables require staff. Writes on `trips`, `bus_locations` and
  `trip_stop_times` are open to any authenticated user - too permissive for production, acceptable
  only because the data is fake.

All views are `security_invoker = on` so policies still apply through them.

An escape hatch to disable RLS entirely is commented at the end of
`migrations/20261001120200_rls_policies.sql` in case policies block the demo.

### Sensitive fields - do not expose directly

| Field | Risk | Handling |
| --- | --- | --- |
| `drivers.license_no`, `drivers.phone` | Personal data | `drivers` is not readable by `anon`. Do not join driver phone into any public view |
| `profiles.email`, `profiles.phone` | Personal data | Owner and staff only |
| `v_active_trips.driver_name`, `driver_phone` | Leaks driver PII into a publicly readable view | **Known issue.** Either stop granting this view to `anon` or build a passenger-facing variant without the driver columns. Flagged under Risks |
| `trips.notes` | Free text from drivers | Publicly readable today; keep operational text out of it |

### Realtime

Not enabled by the migrations, because it depends on how the frontend subscribes. Recommended:

```sql
alter publication supabase_realtime add table public.bus_locations;  -- primary live feed
alter publication supabase_realtime add table public.trips;          -- status and delay changes
alter publication supabase_realtime add table public.service_alerts; -- announcements
```

Subscribe to `bus_locations` inserts, then re-query `v_active_trips`. With a ten-bus fleet that is
cheap and avoids reimplementing the join client-side. Do **not** put `bus_locations` behind a
realtime subscription that fans out every historical row - filter by `trip_id`.

### Server-side operations

These should not be done from the browser with an anon key:

- Writing the GPS feed - use the `service_role` key (it bypasses RLS) or a Next.js route handler.
- Trip lifecycle transitions (start, complete, cancel) - safer as a database function or server
  action than as a client-side `update`, so `progress_km`, `last_stop_order`, `next_stop_id` and
  `buses.status` stay consistent.
- Anything reading `drivers` for an operator screen.

### Indexes

Already created: see each table above. The two that matter most under load are
`bus_locations (bus_id, recorded_at desc)` and
`route_stops (route_id, direction, stop_order)`. No index on `stops (name)` yet - add
`create index stops_name_trgm_idx on public.stops using gin (name gin_trgm_ops);` only if
autocomplete gets slow, and note it needs the `pg_trgm` extension.

## Unresolved

**Member 1's architecture is not in the repository.** There is one commit containing only this
data layer plus a partially-installed Next.js scaffold, and no architecture document on any branch.
Nothing here contradicts the inferable stack, but the following are assumptions, not agreements:

1. The frontend talks to Supabase via `supabase-js` (either from the browser or from server code),
   not through a separate API service that would want its own DTO shapes.
2. Views and RPC functions are an acceptable interface. If Member 1 planned a REST/ORM layer with
   generated types, the views still work but the ETA logic would need to move into application code.
3. Realtime is Supabase Realtime, not a custom WebSocket server.
4. There is no separate map-tile or routing service that expects a particular geometry format
   (GeoJSON, polyline encoding). Route shapes are currently "the stops in order".

If any of these is wrong, say so and I will adjust the data layer rather than work around it.
