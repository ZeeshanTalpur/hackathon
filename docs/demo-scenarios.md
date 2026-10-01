# Demo scenarios, search and analytics

> **DEMO / SIMULATED HACKATHON DATA.** Every route, timetable, fare, bus, driver, trip, delay and
> GPS position below is invented. See [ASSUMPTIONS.md](./ASSUMPTIONS.md).

Re-run `supabase/seed.sql` immediately before presenting. All trip times are generated relative to
`now()`, so re-seeding puts the buses back mid-route and makes the upcoming departures upcoming
again.

## Dataset summary

| Table | Rows | Breakdown |
| --- | --- | --- |
| `routes` | 5 | 4 active, 1 suspended (`KHI-D5`) |
| `stops` | 31 | all active, all on at least one route |
| `route_stops` | 66 | 46 outbound, 20 inbound (`KHI-D1`, `KHI-D2`) |
| `buses` | 10 | 4 active, 3 idle, 1 maintenance, 2 offline |
| `drivers` | 8 | 6 active, 1 off duty, 1 on leave |
| `profiles` | 10 | 1 admin, 2 operators, 3 drivers, 4 passengers |
| `trips` | 10 | 4 in progress, 1 scheduled, 3 completed, 2 cancelled |
| `trip_stop_times` | 78 | generated from `route_stops`; cancelled trips excluded |
| `bus_locations` | 38 | 32 live trail points + 6 last-known fixes |
| `service_alerts` | 7 | 6 active (info / warning / critical), 1 expired |

This is larger than the 3 routes / 15-20 stops / 3-4 trips the brief suggested. The extra data is
deliberate and is listed here so the choice is visible rather than silent:

- **5 routes, 31 stops** rather than 3 and 18, because shared stops are what make journey search
  return more than one option. Saddar sits on four routes; Nursery, Karsaz, Millennium Mall, Boat
  Basin, Teen Talwar, Tower, Power House, Board Office and Nazimabad No. 1 each sit on two or more.
  With three routes most searches return a single result and the search feature looks trivial.
- **10 trips** rather than 4, because the five demo states below need four live or completed trips,
  one `scheduled` trip to start on camera, and three completed trips before "average delay" and
  "route performance" mean anything. One completed trip makes an average of one number.

It is still small enough to read end to end, and the whole dataset loads in well under a second.
If a smaller set is preferred, deleting `KHI-D4` and `KHI-D5` and their trips is a two-statement
change and the validator will tell you exactly which assertions to update.

## Demo 1 - Normal trip

**Story:** a passenger searches Saddar to Millennium Mall, finds route D2, finds a live bus on it,
and sees a position and an ETA.

```sql
-- 1. find direct routes
select route_code, direction, estimated_duration_min, distance_km, fare_pkr, active_trip_count
from public.fn_search_routes(
  (select id from public.stops where code = 'ST-SDR'),
  (select id from public.stops where code = 'ST-MLM'));

-- 2. which buses are approaching the origin stop
select route_code, bus_registration_no, eta_minutes, gps_status
from public.fn_stop_arrivals((select id from public.stops where code = 'ST-SDR'), 5);

-- 3. track the chosen trip
select trip_code, route_code, registration_no, latitude, longitude, speed_kmh, heading_deg,
       progress_pct, next_stop_name, delay_minutes, is_delayed, gps_status, elapsed_minutes
from public.v_active_trips where trip_code = 'TRP-D1-0001';
```

**Expect:** `KHI-D2` outbound with one active trip; `TRP-D1-0001` reporting a live position at
roughly 60% progress, next stop Board Office, 2 minutes late, `gps_status = 'live'`.

## Demo 2 - Live bus movement

**Story:** a driver starts a scheduled trip and the bus begins moving.

`TRP-D1-0002` is seeded as `scheduled`, departing in 25 minutes, on bus `DEMO-KHI-105`, for exactly
this purpose.

```sql
-- driver taps "Start trip"
update public.trips
set status = 'in_progress', actual_start_at = now()
where trip_code = 'TRP-D1-0002';

update public.buses set status = 'active'
where registration_no = 'DEMO-KHI-105';

-- then, per GPS tick (see docs/gps-data-design.md for the full write path)
insert into public.bus_locations
  (bus_id, trip_id, latitude, longitude, speed_kmh, heading_deg, progress_km, source)
select b.id, t.id, p.latitude, p.longitude, 22.0, p.heading_deg, 1.5, 'simulated'
from public.trips t
join public.buses b on b.id = t.bus_id
cross join lateral public.fn_route_point_at_km(t.route_id, t.direction, 1.5) p
where t.trip_code = 'TRP-D1-0002';
```

**Expect:** the trip appears in `v_active_trips` the moment its status changes. Each inserted fix
moves the pin, and `v_trip_stop_eta` recomputes on the next read because nothing is cached.

## Demo 3 - Delayed bus

**Story:** a bus falls behind, the operator sees it, and the passenger sees why.

Two seeded variants, because they are different conditions:

| Trip | Bus | Delay | Speed | Condition |
| --- | --- | --- | --- | --- |
| `TRP-D4-0001` | `DEMO-KHI-108` | +6 min | moving | late but running |
| `TRP-D2-0001` | `DEMO-KHI-102` | +14 min | **0 km/h** | held stationary in traffic |

```sql
-- operator: delayed buses
select registration_no, route_code, trip_code, delay_minutes, speed_kmh, gps_status
from public.v_fleet_status where is_delayed order by delay_minutes desc;

-- passenger: how the delay changes the arrival estimate
select stop_name, eta_minutes, scheduled_arrival_at, estimated_arrival_at, projected_delay_minutes
from public.v_trip_stop_eta e
join public.trips t on t.id = e.trip_id
where t.trip_code = 'TRP-D2-0001' order by stop_order;

-- passenger: the service announcement
select severity, title, message from public.service_alerts
where is_active and route_id = (select id from public.routes where code = 'KHI-D2');
```

**Expect:** both trips flagged `is_delayed`; `projected_delay_minutes` positive for every upcoming
stop; a `warning` alert explaining the Shahrah-e-Faisal traffic. The stationary bus still produces
a finite ETA because the formula falls back to the route planning speed when reported speed is 0 -
this is the single most likely thing to break in a naive implementation, and it is worth pointing
out on camera.

## Demo 4 - GPS failure

**Story:** a bus is still in service but its phone stops reporting. The system must say so rather
than show a stale pin as if it were live.

`TRP-D3-0001` on bus `DEMO-KHI-103` is seeded with its entire GPS trail pushed 14 minutes into the
past. The trip status is still `in_progress` - the bus has not stopped, only the reporting has.

```sql
select trip_code, registration_no, gps_status, location_is_stale,
       location_recorded_at, location_age, latitude, longitude
from public.v_active_trips where gps_status <> 'live';
```

**Expect:** exactly one row, `TRP-D3-0001`, `gps_status = 'stale'`, `location_age` about 14 minutes.

**What the UI must do:**

- Show "Location temporarily unavailable" and the last update time.
- Grey out or hide the pin. Do **not** animate or extrapolate it.
- Label the ETA as a last-known estimate, or hide it. `fn_stop_arrivals` returns `gps_status` on
  every row precisely so an arrivals board can mark the affected entry.
- Keep the trip in the operator's list - it has not ended.

The operator view uses a longer threshold for a different question:

```sql
select registration_no, bus_status, trip_code, telemetry_stale, gps_status, location_age
from public.v_fleet_status where telemetry_stale order by location_age desc;
```

`telemetry_stale` (10 min) means "this vehicle has stopped reporting"; `gps_status` (3 min) means
"this pin is not safe to draw as live". Idle buses parked at a terminal appear in the first list
legitimately - combine it with `bus_status` before calling a bus offline.

There are also two permanently offline buses, `DEMO-KHI-107` (3 days) and `DEMO-KHI-110` (1 day),
with a `critical` alert raised against the first.

## Demo 5 - Completed trip

**Story:** a bus reaches its terminus, live tracking stops, the record remains.

`TRP-D2-0002` is seeded as completed, 8 minutes late. To complete a trip live:

```sql
update public.trips t
set status = 'completed',
    actual_end_at = now(),
    progress_km = r.distance_km,
    next_stop_id = null,
    last_stop_order = (select max(rs.stop_order) from public.route_stops rs
                        where rs.route_id = t.route_id and rs.direction = t.direction)
from public.routes r
where r.id = t.route_id and t.trip_code = 'TRP-D1-0002';

update public.buses set status = 'idle' where registration_no = 'DEMO-KHI-105';
```

**Expect:** the trip leaves `v_active_trips` automatically, because that view filters on
`status = 'in_progress'`. Nothing is deleted, so it stays queryable:

```sql
select trip_code, route_id, service_date, scheduled_start_at, actual_start_at, actual_end_at,
       delay_minutes,
       round(extract(epoch from (actual_end_at - actual_start_at)) / 60.0) as actual_duration_min
from public.trips where status = 'completed' order by actual_end_at desc;
```

## Part 8 - Search support

Everything the brief asks for, with the query that answers it. No route-planning engine.

| Search by | Query |
| --- | --- |
| Starting point and destination (direct routes) | `select * from fn_search_routes($origin_stop_id, $dest_stop_id)` |
| Stop, by name or area | `select * from stops where name ilike $1 or area ilike $1` |
| Stop, by proximity | `select * from fn_nearby_stops($lat, $lon, 2, 10)` |
| Route catalogue | `select * from v_route_summary where is_active` |
| Stops belonging to a route, in order | `route_stops` joined to `stops`, `order by stop_order` |
| Route stop ordering | `route_stops.stop_order`, `distance_from_start_km`, `scheduled_offset_min` |
| Routes serving a stop | `select r.* from route_stops rs join routes r on r.id = rs.route_id where rs.stop_id = $1` |
| Buses running on a route | `select b.* from trips t join buses b on b.id = t.bus_id where t.route_id = $1 and t.status = 'in_progress'` |
| Active trips | `select * from v_active_trips` |
| Approaching buses at a stop | `select * from fn_stop_arrivals($stop_id, 5)` |
| Active service on a route | `v_route_summary.active_trip_count`, `delayed_trip_count` |
| Bus by registration | `select * from v_fleet_status where registration_no = $1` |

Two behaviours worth demonstrating because they show the search is real:

- **Direction is respected.** Saddar to Millennium Mall returns `KHI-D2` outbound; the reverse
  search does not return D2 outbound, it returns the inbound sequence.
- **Suspended routes are excluded.** Korangi Crossing to Tower exists only on `KHI-D5`, which is
  seeded `is_active = false`, so the search correctly returns nothing.

Known limitation: direct routes only. A two-leg journey with a transfer would need a stop-to-stop
graph walk, which is out of scope. Saddar to Tower returns two options, which is enough to show the
ranking works.

## Part 9 - Analytics support

All derivable from stored data. No rollup tables, no dashboard - just confirmation that the model
supports the numbers.

The KPI strip is one row:

```sql
select * from public.v_fleet_overview;
-- total_buses, active_buses, idle_buses, maintenance_buses, offline_buses,
-- active_routes, active_stops, trips_in_progress, delayed_trips, upcoming_trips,
-- avg_delay_minutes, active_alerts
```

| Metric | Source |
| --- | --- |
| Total buses | `count(*) from buses` |
| Active buses | `count(*) from buses where status = 'active'` |
| Delayed buses | `count(*) from v_fleet_status where is_delayed` |
| Active routes | `count(*) from routes where is_active` |
| Completed trips | `count(*) from trips where status = 'completed'` |
| Average delay | `avg(delay_minutes) from trips where status = 'completed'` |
| Average trip duration | `avg(actual_end_at - actual_start_at) from trips where status = 'completed'` |

Route performance:

```sql
select r.code, r.name, r.expected_duration_min,
       count(*) filter (where t.status = 'completed') as completed_trips,
       count(*) filter (where t.status = 'cancelled') as cancelled_trips,
       round(avg(t.delay_minutes) filter (where t.status = 'completed'), 1) as avg_delay_min,
       round(avg(extract(epoch from (t.actual_end_at - t.actual_start_at)) / 60.0)
             filter (where t.status = 'completed'), 1) as avg_actual_duration_min
from public.routes r
left join public.trips t on t.route_id = r.id
group by r.id, r.code, r.name, r.expected_duration_min
order by completed_trips desc;
```

Most-used routes:

```sql
select r.code, r.name, count(t.id) as trip_count
from public.routes r
left join public.trips t on t.route_id = r.id
group by r.id, r.code, r.name
order by trip_count desc;
```

Most-used stops. Two readings, because there is no passenger boarding data in the demo:

```sql
-- by network coverage: how many route directions serve this stop
select s.code, s.name, count(*) as served_by
from public.stops s
join public.route_stops rs on rs.stop_id = s.id
group by s.id, s.code, s.name
order by served_by desc, s.name;

-- by traffic: how many trips have called or will call at this stop
select s.code, s.name, count(*) as trip_calls
from public.stops s
join public.trip_stop_times tst on tst.stop_id = s.id
group by s.id, s.code, s.name
order by trip_calls desc;
```

The second reading uses `trip_stop_times`, which is classified P2 in
[database-plan.md](./database-plan.md). If that table is dropped, use the first reading - it needs
only `route_stops`.

Driver trip history:

```sql
select d.full_name, d.license_no, d.status,
       count(t.id) as total_trips,
       count(*) filter (where t.status = 'completed') as completed,
       count(*) filter (where t.status = 'cancelled') as cancelled,
       round(avg(t.delay_minutes) filter (where t.status = 'completed'), 1) as avg_delay_min
from public.drivers d
left join public.trips t on t.driver_id = d.id
group by d.id, d.full_name, d.license_no, d.status
order by total_trips desc;
```

Because `trips.driver_id` is `on delete set null` rather than cascade, this history survives a
driver record being removed.

Delay distribution, if a chart is wanted:

```sql
select case
         when delay_minutes <= 0 then 'early or on time'
         when delay_minutes < 5 then 'under 5 min'
         when delay_minutes < 15 then '5-15 min'
         else 'over 15 min'
       end as band,
       count(*) as trips
from public.trips
where status in ('in_progress', 'completed')
group by band;
```

## Verification

`scripts/validate-db.mjs` asserts that each of the five demo states is actually present in the
seeded data - exactly one live trip with stale GPS, at least one delayed trip, a stationary bus
with a fresh fix, three completed trips with both actual timestamps, and both active and suspended
routes - along with the analytics queries above returning non-null results.

```bash
npm i -D @electric-sql/pglite
node scripts/validate-db.mjs
```
