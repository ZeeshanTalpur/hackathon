# GPS data design

> **DEMO / SIMULATED HACKATHON DATA.** All positions in the seed are generated, not observed.
> See [ASSUMPTIONS.md](./ASSUMPTIONS.md).

## Decision: current location *and* history (option C), with current derived from history

There is one table, `bus_locations`, which is append-only history. The "current location" is not a
second place where data is stored - it is a view over the newest row per bus:

```sql
create view public.v_bus_latest_location as
select distinct on (bl.bus_id) bl.bus_id, bl.trip_id, bl.recorded_at, bl.latitude, bl.longitude,
       bl.speed_kmh, bl.heading_deg, bl.progress_km, bl.source, (now() - bl.recorded_at) as location_age
from public.bus_locations bl
order by bl.bus_id, bl.recorded_at desc;
```

### Why not current-only (option A)

It fails three of the four things the system must do. Trip history would not exist, so route
performance and "average trip duration" are unanswerable. The simulator could not replay a path.
And the stale-GPS demo becomes guesswork, because with a single mutable row there is no record of
*when* reporting stopped relative to earlier fixes.

### Why not history-only with no current accessor (option B)

Functionally fine, but every consumer would hand-write the same "newest row per bus" query, and
getting it wrong (a plain `order by ... limit 1` inside a loop, or a `max(recorded_at)` self-join
that returns duplicates on ties) is the most likely performance bug in a hackathon build. One
`distinct on` view, used everywhere, removes that risk.

### Why not both as separate tables

A `buses.current_latitude/longitude` pair plus a history table is the obvious-looking design and it
is the one to avoid: two copies of the same fact that can disagree, and a write path that must
update both atomically. Deriving the current fix costs one index seek on
`bus_locations (bus_id, recorded_at desc)`. With a ten-bus demo fleet the cost is irrelevant; at
real scale the same index still makes it cheap.

The one case where a cached column would be justified is a fleet of thousands with a
seconds-level refresh. We are two developers with five hours and ten buses.

## Stored fields

| Field | Type | Required | Source |
| --- | --- | --- | --- |
| `bus_id` | uuid FK | yes | Which vehicle |
| `trip_id` | uuid FK | no | Null between trips, so a parked bus can still report |
| `recorded_at` | timestamptz | yes | **The GPS availability signal.** Everything about staleness derives from this |
| `latitude`, `longitude` | numeric(9,6) | yes | Range-checked; ~0.1 m precision, no float drift |
| `speed_kmh` | numeric(5,2) | yes | `>= 0`. Zero is meaningful (stopped), not missing |
| `heading_deg` | numeric(5,2) | no | `0 <= x < 360`. Used to rotate the bus icon |
| `progress_km` | numeric(6,2) | no | Distance along the route at this fix - lets a trail be replayed without re-deriving position |
| `source` | text | yes | `device` (real browser geolocation), `simulated` (demo simulator), `manual` (operator correction) |

`source` is the field that keeps the project honest: a reviewer can tell at a glance which rows
came from a real phone and which were generated.

### Current and next stop

Not stored on the location row. `trips.next_stop_id` and `trips.last_stop_order` are derived from
`trips.progress_km`, so they live with the trip, not with every fix. Storing them per fix would
duplicate the same value across dozens of rows and could drift from `progress_km`.

### GPS availability and last update time

There is no `gps_available` boolean. Availability is computed from the age of the newest fix, which
is strictly better: a boolean can be left stale by a crashed client, whereas a timestamp cannot lie
about how old it is.

Two thresholds, because they answer different questions:

| Signal | Threshold | View | Question it answers |
| --- | --- | --- | --- |
| `gps_status` / `location_is_stale` | 3 minutes | `v_active_trips`, `v_trip_stop_eta`, `v_fleet_status` | Passenger-facing: is this pin safe to draw as live? |
| `telemetry_stale` | 10 minutes | `v_fleet_status` | Operator-facing: has this vehicle stopped reporting? |

`gps_status` is a three-valued text column so the UI needs no arithmetic:

```
'live'    -- newest fix is under 3 minutes old
'stale'   -- newest fix is older than 3 minutes
'no_fix'  -- the bus has never reported
```

`location_age` (an interval) and `location_recorded_at` are also exposed, so the UI can render
"updated 4 minutes ago" without a second query.

A consequence worth knowing: an idle bus parked at a terminal shows `telemetry_stale = true`,
because it genuinely stopped reporting. Combine it with `buses.status` rather than reading it alone
as "offline".

## Position interpolation

`fn_route_point_at_km(route_id, direction, km)` returns the latitude, longitude and bearing at any
distance along a route, by linear interpolation between the two bracketing stops. It clamps at both
ends, so a distance past the final stop returns the final stop.

This is used in two places and will be used in a third:

1. The seed generates its GPS trails with it, so every seeded fix sits exactly on the polyline the
   map will draw - no hand-typed coordinates and no points floating off-route.
2. `data/gps-scenarios.json` embeds a sample ladder computed with it.
3. The simulator, when it is built, should advance `progress_km` and ask this function for the
   coordinates rather than interpolating in JavaScript.

Limitation: straight lines between stops, not road-snapped. Where consecutive stops are far apart
the bus can appear to cut across blocks. The fix, if there is time, is intermediate shape points in
`route_stops` or a separate shape table - not a change to this function's interface.

## Write path

Per fix, during a trip:

```sql
-- 1. append the fix
insert into public.bus_locations
  (bus_id, trip_id, latitude, longitude, speed_kmh, heading_deg, progress_km, source)
values ($bus, $trip, $lat, $lon, $speed, $heading, $progress, 'device');

-- 2. advance the trip and re-derive the stop pointers from progress_km
update public.trips t
set progress_km = $progress,
    last_stop_order = coalesce((
      select max(rs.stop_order) from public.route_stops rs
      where rs.route_id = t.route_id and rs.direction = t.direction
        and rs.distance_from_start_km <= $progress), 0),
    next_stop_id = (
      select rs.stop_id from public.route_stops rs
      where rs.route_id = t.route_id and rs.direction = t.direction
        and rs.distance_from_start_km > $progress
      order by rs.stop_order limit 1)
where t.id = $trip;
```

Never set `last_stop_order` or `next_stop_id` from the client independently of `progress_km` - that
is how the three values drift apart. Deriving them in the same statement is what the seed does, and
why the validator can assert they always agree.

Recommended: run this write path server-side with the `service_role` key, or wrap it in a database
function. The current RLS policy allows any authenticated user to write locations, which is fine
for fake data and not fine for anything else.

## Volume

At a 5 second tick, one bus produces 720 rows per hour. Ten buses for a three-hour demo is ~21,600
rows - trivial for Postgres, and the `(bus_id, recorded_at desc)` index keeps the latest-fix lookup
at one seek regardless. No partitioning, retention policy or downsampling is needed at this scale,
and adding any would be premature.

If the table ever does need trimming, the safe rule is to delete fixes for `completed` trips older
than N days; `trips` retains the aggregate facts, so analytics survive.

## Realtime

Not enabled by the migrations - it depends on how the frontend subscribes. The intended shape:

```sql
alter publication supabase_realtime add table public.bus_locations;
```

Subscribe to inserts, filtered by `trip_id` for a passenger tracking one bus, then re-read
`v_active_trips` for the joined detail. Subscribing without a filter and re-rendering the whole
fleet on every fix will work at ten buses but is the first thing to break if the fleet grows.

`trips` and `service_alerts` are also worth publishing, for status changes and announcements.

## Seeded GPS state

| Bus | Trip | Fixes | Newest fix | `gps_status` |
| --- | --- | --- | --- | --- |
| `DEMO-KHI-101` | `TRP-D1-0001` | 8-point trail | ~30 s | `live` |
| `DEMO-KHI-102` | `TRP-D2-0001` | 8-point trail, speed 0 on the newest | ~30 s | `live` |
| `DEMO-KHI-103` | `TRP-D3-0001` | 8-point trail, whole trail aged 14 min | ~14.5 min | `stale` |
| `DEMO-KHI-108` | `TRP-D4-0001` | 8-point trail | ~30 s | `live` |
| `DEMO-KHI-104/105/109` | none | single last-known fix | 40-95 min | `stale` |
| `DEMO-KHI-106` | none | single last-known fix | 5 h | `stale` |
| `DEMO-KHI-107` | none | single last-known fix | 3 days | `stale` |
| `DEMO-KHI-110` | none | single last-known fix | 1 day | `stale` |

`DEMO-KHI-102` (reporting, not moving) and `DEMO-KHI-103` (moving, not reporting) are the two cases
that are easy to conflate and are seeded distinctly on purpose. See
[demo-scenarios.md](./demo-scenarios.md).
