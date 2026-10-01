# ETA data design

> **DEMO / SIMULATED HACKATHON DATA.** See [ASSUMPTIONS.md](./ASSUMPTIONS.md).

No machine learning, no model, no inference service. The ETA is arithmetic over columns that
already exist, and it is explainable in one line to a judge.

## Required inputs and where each one lives

Every input the brief lists is already stored. Nothing new was added to the schema for ETA.

| Input | Column | Notes |
| --- | --- | --- |
| Current bus location | `bus_locations.latitude` / `longitude`, newest row via `v_bus_latest_location` | Not used directly in the formula - `progress_km` is the along-route projection of it, which is what the arithmetic needs |
| Route progress | `trips.progress_km` | Distance covered from the route origin. Single source of truth for position |
| Remaining route distance | `route_stops.distance_from_start_km - trips.progress_km` | Per target stop |
| Current speed | `bus_locations.speed_kmh` (newest) | Zero means stopped, which is why the fallback below exists |
| Planning speed | `routes.avg_speed_kmh` | Fallback when reported speed is 0 or absent |
| Expected / scheduled travel time | `routes.expected_duration_min`, `route_stops.scheduled_offset_min` | Offsets, so one route definition serves every departure |
| Existing delay | `trips.delay_minutes` | Signed: positive late, negative early |
| Elapsed trip time | `now() - coalesce(trips.actual_start_at, trips.scheduled_start_at)` | Exposed as `v_active_trips.elapsed_minutes` |
| Timetable anchor | `trips.scheduled_start_at` | Scheduled arrival = anchor + stop offset |
| GPS freshness | `bus_locations.recorded_at` -> `gps_status` | Tells the UI whether the estimate is live or extrapolated |

## The calculation

Implemented once, in the view `v_trip_stop_eta`:

```
remaining_km = max(route_stops.distance_from_start_km - trips.progress_km, 0)
speed_kmh    = coalesce(nullif(latest_fix.speed_kmh, 0), routes.avg_speed_kmh)
travel_min   = remaining_km / speed_kmh * 60
dwell_min    = 0.5 * max(stops_ahead - 1, 0)
eta_minutes  = ceil(travel_min + dwell_min)
```

and from that:

```
estimated_arrival_at    = now() + eta_minutes
scheduled_arrival_at    = trips.scheduled_start_at + route_stops.scheduled_offset_min
projected_delay_minutes = estimated_arrival_at - scheduled_arrival_at
```

`stops_ahead` is `route_stops.stop_order - trips.last_stop_order`, so the dwell allowance only
counts stops the bus has not served yet.

### Why `nullif(speed_kmh, 0)` is the most important part

A bus held in traffic reports `speed_kmh = 0`. Divide by that and the ETA is infinite, which in a
UI means `Infinity`, `NaN`, or a blank where a number should be. Coalescing to the route's planning
speed turns a stopped bus into "it will take about as long as the timetable says", which is both
finite and defensible.

The seed includes exactly this case (`TRP-D2-0001`, stationary before Karsaz) so the fallback is
visible in the demo rather than theoretical.

### Why `progress_km` and not straight-line distance

The obvious alternative is `fn_haversine_km(bus_position, stop_position)`. It is wrong for buses: a
bus 500 m from a stop as the crow flies may be 4 km away along a one-way corridor, and a bus that
has already passed a stop would show a small positive distance instead of being excluded.

Projecting position onto the route as `progress_km` fixes both: distance is measured along the
path, and a passed stop has negative remaining distance, which the view filters out with
`stop_order > last_stop_order`.

`fn_haversine_km` is still used, but for what it is good at: "stops near me" (`fn_nearby_stops`).

## Worked example from the seeded data

`TRP-D2-0001` on route `KHI-D2`, `progress_km = 11.20`, newest reported speed `0`,
`routes.avg_speed_kmh = 17.40`, `last_stop_order = 6`, `delay_minutes = 14`:

| Stop | order | `distance_from_start_km` | `remaining_km` | `eta_minutes` | `projected_delay_minutes` |
| --- | --- | --- | --- | --- | --- |
| Karsaz | 7 | 12.30 | 1.10 | 4 | +15 |
| Millennium Mall | 8 | 13.70 | 2.50 | 10 | +17 |
| NIPA Chowrangi | 9 | 17.00 | 5.80 | 21 | +16 |
| Gulshan-e-Iqbal Chowrangi | 10 | 18.00 | 6.80 | 25 | +15 |

Karsaz: `1.10 / 17.40 * 60 = 3.79` minutes travel, `0.5 * max(7 - 6 - 1, 0) = 0` dwell,
`ceil(3.79) = 4`. The speed used is 17.40 and not 0 because of the fallback.

## Access patterns

```sql
-- every upcoming stop of every live trip
select * from public.v_trip_stop_eta;

-- one trip, one stop
select public.fn_trip_eta_minutes($trip_id, $stop_id);

-- arrivals board for a stop, soonest first
select * from public.fn_stop_arrivals($stop_id, 5);
```

All three are stable reads with no caching, so they reflect the newest fix the instant it lands.

## Honesty requirements

The ETA must not pretend to know more than it does.

1. **Label extrapolated estimates.** `v_trip_stop_eta.gps_status` and `fn_stop_arrivals.gps_status`
   return `stale` when the estimate was computed from a fix older than 3 minutes. Show it as a
   last-known estimate, or hide it - do not present it as live. `TRP-D3-0001` is seeded as this
   case.
2. **Do not invent a position.** The formula never advances `progress_km` on its own. If no fix
   arrives, the ETA stops improving and `gps_status` says why.
3. **Do not describe it as AI.** It is division. Calling it prediction in the demo would be a
   misrepresentation, and a judge who reads the view will see the arithmetic.

## Known weaknesses

These are the weakest assumptions in the system, stated plainly:

- No traffic, time-of-day, day-of-week or weather signal.
- Dwell time is a flat 0.5 min per stop, regardless of how busy the stop is.
- One planning speed per route, not per segment, so a corridor that is fast at one end and
  congested at the other is averaged.
- Straight-line route geometry means `distance_from_start_km` slightly understates real road
  distance.

## If the project continues

The first improvement is **not** a model. It is per-segment speeds derived from the data already
being collected:

```sql
-- average observed speed per route segment, from history
select rs.route_id, rs.direction, rs.stop_order, round(avg(bl.speed_kmh), 1) as observed_speed
from public.bus_locations bl
join public.trips t on t.id = bl.trip_id
join public.route_stops rs
  on rs.route_id = t.route_id and rs.direction = t.direction
 and bl.progress_km >= rs.distance_from_start_km
group by rs.route_id, rs.direction, rs.stop_order;
```

Feeding a per-segment speed into the same formula keeps it deterministic and explainable while
making it materially more accurate. That is a better use of the next hour than any model, and the
schema already stores everything it needs.
