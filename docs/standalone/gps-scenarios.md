# GPS simulation scenarios

> **DEMO / SIMULATED HACKATHON DATA.** All movements below are scripted for a demonstration on
> invented routes. No real vehicle is tracked. See [demo-data.md](./demo-data.md).

This is a **specification**. No simulator is implemented here, and none of this assumes a
particular backend: a Node script, an edge function or a browser loop can all follow it. The
machine-readable version is `gps_scenarios` in
[`data/standalone/karachi-demo-data.json`](../../data/standalone/karachi-demo-data.json). Every number in this document is
re-derived by `node scripts/validate-standalone-data.mjs`, and that script's helpers double as a reference
implementation of the rules below.

This is not the spec for `data/gps-scenarios.json` on `main`. That file is generated from the seed
and documented in [`docs/gps-data-design.md`](../gps-data-design.md).

## 1. Simulation model

### 1.1 Clock and fixes

- `t` is seconds since **T0**, when the data is loaded and the simulator starts. A scenario begins
  at `starts_at_s`.
- A simulated GPS fix is emitted every **5 s** (`meta.thresholds.gps_tick_s`) at
  `starts_at_s + k × 5`, except during an outage (§1.5).
- Suggested fix payload (not a schema): `bus_id`, `trip_id`, `recorded_at = T0 + t`, `latitude`,
  `longitude`, `speed_kmh`, `heading_deg`, `source` (`simulated`, or `device` for the driver's phone).

### 1.2 Route line and position

A route direction is its `route_stops` rows ordered by `sequence`. Each row gives a stop, its
`distance_from_start_km` (km<sub>i</sub>) and `scheduled_offset_min` (off<sub>i</sub>). A bus's
position along the line is one number, **progress p** (km from the first stop).

```
i  = last stop index with km[i] <= p          # a bus exactly at a stop has reached it
f  = (p - km[i]) / (km[i+1] - km[i])
lat = lat[i] + f * (lat[i+1] - lat[i])         # straight line between the two stops,
lon = lon[i] + f * (lon[i+1] - lon[i])         # not road-snapped
heading = initial bearing from stop i to stop i+1
starting_stop = stop i, next_stop = stop i+1   # next_stop is null at the terminus
```

### 1.3 Timetable position and delay

```
sched(p)  = off[i] + f * (off[i+1] - off[i])            # minutes after scheduled start the bus
                                                        # is timetabled to be at p
delay_min = (t/60 - scheduled_start_offset_min) - sched(p)   # + late, - early
```

Delay is compared against the timetable at the bus's **current position**, so it changes while the
bus is held up and stays constant while it runs at timetable pace. Display it and compare it with
thresholds after rounding to 0.1 min.

### 1.4 Motion phases

Phases run back to back from `starts_at_s` and `initial_progress_km`. Each ends at `until_s`.
At a boundary the **new** phase applies.

| Type | Fields | Behaviour |
| --- | --- | --- |
| `follow_schedule` | `until_s` | Keeps the delay it starts with: `p(t) = sched⁻¹(t/60 − start − delay₀)`. Reported speed is the timetable pace of the current segment (segment km ÷ segment min × 60). |
| `drive` | `speed_kmh`, `until_s` (+ `until_km` or `duration_s` for readability) | Constant speed. `speed_kmh: 0` means stopped. |
| `dwell` | `at_stop_id`, `duration_s`, `until_s` | Stationary at that stop with speed 0. |

The bus never passes the last stop; progress is clamped to the route distance.

### 1.5 GPS outages

`gps.outages[]` entries are `{ "last_fix_s": 420, "restored_s": 600 }`. Fixes are emitted at ticks
up to and including `last_fix_s`, then nothing until `restored_s` (`null` = never). The simulator
keeps moving the bus internally, because the real bus does not stop when its phone loses signal,
but it **emits nothing**. Checkpoints show that ground truth plus `displayed_position`, which is
what the platform is allowed to show: the last fix.

## 2. "No fake live data" rules

These are the behaviours the scenarios exist to prove:

1. **Never move a marker without a new fix.** No dead-reckoning, extrapolation or interpolation
   across a gap.
2. **Always know the fix age.** Once it passes the live threshold, grey the marker and say
   "Last updated N s ago".
3. **After the unavailable threshold, say "Location temporarily unavailable."** ETAs fall back to
   timetable times explicitly labelled **"Scheduled"**, never presented as live.
4. **On restore, jump to the new fix.** Do not back-fill the gap with invented points.
5. **Stopped is not offline.** A stationary bus with fresh fixes is "Stopped". A short stop does
   not make a bus "Delayed"; only the delay threshold does.
6. **GPS loss is a tracking problem, not a service change.** The trip stays `in_progress`.
7. **Only buses on an in-progress trip get a tracking state.** Idle or parked buses with old fixes
   are not alarms.

## 3. Derived states and thresholds

All thresholds live in `meta.thresholds` and are **proposed demo defaults**. They are short
on purpose so judges see transitions within about a minute.

| State | Rule (demo values) |
| --- | --- |
| tracking `live` | last fix age ≤ **30 s** |
| tracking `stale` | 30 s < age ≤ **90 s**: show last position greyed, "Last updated N s ago" |
| tracking `unavailable` | age > 90 s: "Location temporarily unavailable" |
| motion `at_stop` | speed ≤ **3 km/h** and within **50 m** of a stop |
| motion `stopped` | speed ≤ 3 km/h, not at a stop |
| motion `approaching` | speed > 3 km/h and next stop within **300 m** |
| motion `moving` | otherwise |
| punctuality `delayed` | delay ≥ **+5.0 min** |
| punctuality `early` | delay < **−1.0 min** |
| punctuality `on_time` | otherwise |

`main` uses different values (migration `20261001130000_gps_freshness.sql`). Its passenger-facing
`gps_status` turns `stale` after **3 minutes** (values `live` / `stale` / `no_fix`), and the
operator flag `telemetry_stale` after **10 minutes**. With those values, Demo 4's "unavailable"
appears 3 minutes after the last fix instead of 90 s. Pick one set before wiring the UI.

## 4. Scenarios at a glance

All five run on the T0 dataset at the same time, so the operator dashboard shows every state at
once.

| | Scenario | Bus / trip / route | Starting stop | Next stop | Current simulated coordinates | Speed | Delay | Route progress | Expected state |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **A** | On-time bus (t = 0) | `BUS-01` / `TRIP-01` / `ROUTE-01` outbound | Merewether Tower | Saddar, 2.529 km ahead | 24.85396, 67.01091 | 15.2 km/h | +2.0 min | 1.771 of 18.1 km (9.8%) | live · moving · **on time** |
| **B** | Delayed bus (t = 0) | `BUS-02` / `TRIP-02` / `ROUTE-02` outbound | Nursery | Karsaz, 2.000 km ahead | 24.86900, 67.07939 | 15.0 km/h | **+11.9 min** | 11.700 of 23.5 km (49.8%) | live · moving · **delayed** |
| **C** | Approaching a stop (t = 0) | `BUS-03` / `TRIP-03` / `ROUTE-03` inbound | Abdullah Shah Ghazi | Teen Talwar, **280 m** ahead | 24.83183, 67.03342 | 18.0 km/h | +0.8 min | 4.620 of 8.8 km (52.5%) | live · **approaching** · on time |
| **D** | Stopped temporarily (t = 340) | `BUS-03` / `TRIP-03` (continues C) | Teen Talwar | Metropole, 1.600 km ahead | 24.83940, 67.03270 | **0 km/h** | +2.7 min | 5.700 of 8.8 km (64.8%) | live · **stopped** · on time |
| **E** | GPS unavailable (t = 540) | `BUS-04` / `TRIP-04` / `ROUTE-01` outbound | Merewether Tower | Saddar | 24.85035, 67.00126 = **last fix, frozen** | unknown (last 15.2) | unknown (last 0.0) | 0.506 km (2.8%), frozen | **unavailable** |

Scenario E also covers a bus that is simply offline with no trip (`BUS-05`, §5.E).

## 5. Scenario details

Checkpoints below are a subset. The JSON has one every 60 s plus every phase boundary.

### A. On-time bus: `BUS-01` on `ROUTE-01` (Tower → University of Karachi)

`TRIP-01` was timetabled to leave Merewether Tower at T0−9 and left at T0−8. At T0 it is on M.A.
Jinnah Road, 2.5 km before Saddar and +2.0 min behind the timetable, which is within the on-time
band.

Motion: `follow_schedule` until t = 1800. Delay stays +2.0. It reaches Saddar at **t = 600**
(timetable T0+8, plus 2 min).

| t (s) | Progress (km) | Speed | Delay | Next stop | State |
| --- | --- | --- | --- | --- | --- |
| 0 | 1.771 | 15.2 | +2.0 | Saddar | moving, on time |
| 180 | 2.529 | 15.2 | +2.0 | Saddar | moving, on time |
| 540 | 4.047 | 15.2 | +2.0 | Saddar | **approaching** (253 m) |
| 600 | 4.300 | 13.5 | +2.0 | Numaish | at Saddar, continuing |

Expected: passenger sees "Bus 201 · On time" moving towards Saddar; operator sees In service ·
On time. This is the hero bus for Demo 1, and Demo 2 later holds it in traffic.

### B. Delayed bus: `BUS-02` on `ROUTE-02` (Tower → Airport)

`TRIP-02` (timetabled T0−52) is crawling at 15 km/h in heavy traffic between Nursery and Karsaz,
11.9 min late. `ALERT-01` describes the jam.

Motion: `drive` 15 km/h to Karsaz (arrives **t = 480**) → `dwell` 60 s at Karsaz →
`follow_schedule`. The delay keeps growing until the bus leaves Karsaz, then holds.

| t (s) | Progress (km) | Speed | Delay | Next stop | State |
| --- | --- | --- | --- | --- | --- |
| 0 | 11.700 | 15.0 | +11.9 | Karsaz | moving, delayed |
| 300 | 12.950 | 15.0 | +13.8 | Karsaz | moving, delayed |
| 480 | 13.700 | 0 | +15.0 | Drigh Road | **at_stop** Karsaz, delayed |
| 540 | 13.700 | 27.0 | +16.0 | Drigh Road | moving, delayed |
| 600 | 14.150 | 27.0 | +16.0 | Drigh Road | moving, delayed |

Expected: passenger sees "Delayed" with the delay in minutes; operator sees BUS-02 highlighted as
delayed for the whole demo. This is the "already delayed" bus the operator dashboard shows from
the first second.

### C. Approaching a stop: `BUS-03` on `ROUTE-03` inbound (Sea View → Saddar)

`TRIP-03` (timetabled T0−16, +0.8 min) is 280 m before Teen Talwar, braking.

Motion: `drive` 18 km/h for 200 m → `drive` 8 km/h for 80 m → arrives at **t = 76** → `dwell`
60 s (Teen Talwar's `typical_dwell_s`) → departs at **t = 136**.

| t (s) | Progress (km) | Speed | Delay | Starting → next stop | State |
| --- | --- | --- | --- | --- | --- |
| 0 | 4.620 | 18.0 | +0.8 | Abdullah Shah Ghazi → Teen Talwar | **approaching** |
| 40 | 4.820 | 8.0 | +0.9 | Abdullah Shah Ghazi → Teen Talwar | approaching (80 m) |
| 76 | 4.900 | 0 | +1.3 | Teen Talwar → Metropole | **at_stop** |
| 136 | 4.900 | 20.0 | +2.3 | Teen Talwar → Metropole | moving |

Expected: the Teen Talwar stop board shows "Bus 203 · Arriving" before t = 76, then the bus
disappears from that board once it has departed.

### D. Stopped temporarily: `BUS-03`, continuing from C

After leaving Teen Talwar the bus drives 800 m towards Metropole and then **stops between stops
for 120 s** (t = 280 to 400): a signal or congestion. Its phone keeps sending fixes, then it
resumes at timetable pace.

| t (s) | Progress (km) | Speed | Delay | State |
| --- | --- | --- | --- | --- |
| 240 | 5.478 | 20.0 | +1.8 | moving |
| 280 | 5.700 | 0 | +1.7 | **stopped** (live) |
| 340 | 5.700 | 0 | +2.7 | **stopped** (live) |
| 400 | 5.700 | 16.0 | +3.7 | moving |
| 600 | 6.589 | 16.0 | +3.7 | moving |

Expected: "Stopped · updated seconds ago", **not** "offline" and **not** "delayed". The delay
peaks at +3.7 min, a 1.3 min margin below the threshold. The validator checks every second of
the stop to make sure the bus never reads as delayed or offline.

### E. Offline / GPS unavailable: `BUS-04` on `ROUTE-01`, plus `BUS-05`

**E1: driver GPS lost mid-trip (Demo 4).** Precondition: `TRIP-04` is in progress, started by the
driver in Demo 3 at t = 300 (its timetabled departure, T0+5), or by the simulator at the same
moment. The trip runs to the timetable (`follow_schedule`). The phone's last fix is at
**t = 420**, about 0.5 km out of Tower. Fixes resume at **t = 600**.

| t (s) | Fix age | Tracking | What the platform shows | Simulator ground truth (hidden) |
| --- | --- | --- | --- | --- |
| 300 | 0 | live | 24.84890, 66.99740 (trip starts at Tower) | 0.000 km |
| 420 | 0 | live | 24.85035, 67.00126, **last fix** | 0.506 km |
| 450 | 30 | live | same point, frozen (no new fix) | 0.632 km |
| 455 | 35 | **stale** | same point, greyed, "Last updated 35 s ago" | 0.653 km |
| 515 | 95 | **unavailable** | "Location temporarily unavailable"; times labelled "Scheduled" | 0.906 km |
| 540 | 120 | unavailable | unchanged | 1.012 km |
| 600 | 0 | live | **jumps** to 24.85252, 67.00705 | 1.265 km |

Speed and delay are **unknown** while unavailable: the snapshot sets them to `null`, keeping
`last_reported_speed_kmh` 15.2 and `last_known_delay_min` 0.0 for reference only. The operator
sees "GPS signal lost · last seen N min ago", and the trip stays `in_progress`.

**E2: offline bus with no trip.** `BUS-05` has `status: offline`. Its last fix was T0−170 min at
Sea View (`bus_positions_at_t0`), and `ALERT-03` is an operator-only critical alert about it.
Passengers never see it, because it has no trip. Operators see "Offline · last seen 2 h 50 min
ago at Sea View".

## 6. Canonical timeline

If the simulator runs unattended from T0, these events happen in this order. When a presenter
triggers events by hand, the effects stay the same **relative to the trigger** (for example, Demo
2's bus turns "Delayed" 204 s after its trigger).

| t (s) | Event |
| --- | --- |
| 0 | A, B and C running; `TRIP-04` scheduled at Tower. Fleet: 3 in service, 1 delayed. |
| 60 | **Demo 2 trigger.** `BUS-01` held in traffic at 2 km/h on M.A. Jinnah Road. |
| 76 | `BUS-03` arrives at Teen Talwar (C). |
| 136 | `BUS-03` departs Teen Talwar. |
| **264** | `BUS-01` delay reaches +5.0: shown as **Delayed**. Delayed count goes from 1 to 2. |
| 280–400 | `BUS-03` stopped temporarily (D), still live and on time. |
| 300 | **Demo 3.** Driver starts `TRIP-04` at Tower; fixes start; trips in progress go from 3 to 4. |
| 360 | `BUS-01` traffic clears; it continues at +6.3 min (still delayed). |
| 420 | **Demo 4.** Last fix from `BUS-04`. |
| > 450 | `BUS-04` stale. |
| 480 | `BUS-02` reaches Karsaz. |
| > 510 | `BUS-04` unavailable: "Location temporarily unavailable". |
| 600 | `BUS-04` fixes resume and the marker jumps forward. |
| ≈ 860 | `BUS-01` reaches Saddar about 6 min late (would have been t = 600). |

## 7. Using the checkpoints as test fixtures

Every checkpoint has `t_s`, `progress_km`, `latitude`, `longitude`, `speed_kmh`, `delay_min`,
`starting_stop_id`, `next_stop_id`, `motion_state` and `punctuality`. Scenario E checkpoints also
have `last_fix_age_s`, `tracking_state`, `fix_available` and, where needed, `displayed_position`.
Scenarios without an outage are `live` throughout.

A simulator that follows §1 reproduces the checkpoints within these tolerances: 0.0015 km
progress, 0.00002° coordinates, and 0.05 for speed and delay. Those are the tolerances the
validator uses. Demo 2's override timeline and checkpoints live in `demo_stories[1]`. See
[demo-scenarios.md](./demo-scenarios.md).
