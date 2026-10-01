# ETA input data specification

> **DEMO / SIMULATED HACKATHON DATA.** Distances, timetables and "historical" times below are
> estimated or invented for the demo routes. See [demo-data.md](./demo-data.md).

This document defines the **inputs** a deterministic ETA needs and where each one lives in
[`data/standalone/karachi-demo-data.json`](../../data/standalone/karachi-demo-data.json). It does **not** choose an ETA
algorithm and there is no machine learning. §5 lists candidate methods with worked numbers so the
team can compare them on the same inputs.

## 1. Required inputs and where they live

| Input | Field(s) | Level | Unit |
| --- | --- | --- | --- |
| **Route distance** | `routes[].distance_km`; per stop `route_stops[].distance_from_start_km` | route | km |
| **Remaining distance** | `trips[].live.remaining_km` (to the terminus); to any stop: `distance_from_start_km(stop) − live.progress_km` | trip | km |
| **Scheduled duration** | `routes[].scheduled_duration_min`; per stop `route_stops[].scheduled_offset_min`; `trips[].scheduled_start_offset_min` / `scheduled_end_offset_min` | route, trip | min |
| **Elapsed trip time** | `trips[].live.elapsed_since_scheduled_start_min`, `elapsed_since_actual_start_min` | trip | min |
| **Current speed** | `trips[].live.current_speed_kmh`; every GPS fix (`bus_positions_at_t0[].speed_kmh`, scenario checkpoints) | trip, fix | km/h |
| **Historical / expected segment duration** | `eta_inputs.route_segments[].historical_run_min.offpeak` / `.peak`; timetable value `scheduled_run_min` | segment | min |
| **Delay minutes** | `trips[].live.delay_min` (signed, + late) | trip | min |
| **Route progress** | `trips[].live.progress_km`, `progress_pct`, `current_segment_sequence`, `segment_fraction`, `starting_stop_id`, `next_stop_id`, `distance_to_next_stop_km` | trip | km, % |

Supporting fields:

- `stops[].typical_dwell_s`: 30–60 s.
- `routes[].planning_speed_kmh`: route distance ÷ scheduled duration, a fallback speed.
- `meta.time_bands` and `meta.demo_time_band` (`offpeak`).
- `trips[].live.last_fix_age_s` and `tracking_state`: whether the live inputs can be trusted at
  all.

## 2. Field reference

### 2.1 Route level

| Route | Distance | Scheduled duration | Planning speed |
| --- | --- | --- | --- |
| `ROUTE-01` | 18.1 km | 65 min | 16.7 km/h |
| `ROUTE-02` | 23.5 km | 69 min | 20.4 km/h |
| `ROUTE-03` | 8.8 km | 31 min | 17.0 km/h |
| `ROUTE-04` (inactive) | 11.2 km | 37 min | 18.2 km/h |

`route_stops` gives the cumulative km and timetable minute for every stop, in **both** directions.
Inbound is the outbound timetable mirrored.

### 2.2 Segment level (`eta_inputs.route_segments`, 48 rows)

One row per consecutive stop pair, per direction:

```json
{"route_id": "ROUTE-01", "direction": "outbound", "sequence": 1, "from_stop_id": "STOP-01", "to_stop_id": "STOP-02",
 "distance_km": 4.3, "scheduled_run_min": 17, "historical_run_min": {"offpeak": 17.9, "peak": 30.6}}
```

- `distance_km` is the difference of the two stops' `distance_from_start_km`.
- `scheduled_run_min` is the difference of their `scheduled_offset_min`.
- `historical_run_min` holds **simulated** typical times by time band: off-peak 0.95–1.05 × the
  timetable; peak 1.2–1.8 × the timetable. The slowest stretches are Tower–Saddar (M.A. Jinnah
  Road) and Nursery–Karsaz (Shahrah-e-Faisal).
- All stop-to-stop times are **arrival to arrival**, so they already include the dwell at the
  earlier stop. Do not add dwell again when using them.

### 2.3 Trip level (`trips[].live`, the snapshot at T0)

`TRIP-01` at T0:

| Field | Value | Field | Value |
| --- | --- | --- | --- |
| `route_distance_km` | 18.1 | `elapsed_since_scheduled_start_min` | 9.0 |
| `scheduled_duration_min` | 65 | `elapsed_since_actual_start_min` | 8.0 |
| `progress_km` | 1.771 | `scheduled_offset_at_position_min` | 7.0 |
| `remaining_km` | 16.329 | `delay_min` | +2.0 |
| `progress_pct` | 9.8 | `current_speed_kmh` | 15.2 |
| `current_segment_sequence` / `segment_fraction` | 1 / 0.412 | `last_fix_age_s` / `tracking_state` | 0 / live |
| `starting_stop_id` → `next_stop_id` | `STOP-01` → `STOP-02` | `distance_to_next_stop_km` | 2.529 |

The live trips at T0: `TRIP-01` (+2.0, moving), `TRIP-02` (+11.9, crawling at 15 km/h) and
`TRIP-03` (+0.8, approaching a stop). `TRIP-04` is scheduled and has no live block until it
starts.

### 2.4 What changes with each GPS fix

A new fix updates `current_speed_kmh`, the position and `last_fix_age_s`. Progress then has to be
recomputed:

- **Simulator.** It knows progress directly, because the scenarios are defined in progress.
- **Driver's phone.** Project the fix onto the route line: the nearest point on the stop-to-stop
  segments, accepting only forward movement. This step is **not specified yet**.

Remaining distance, timetable position, delay and the derived states then follow from the
definitions in §3.

## 3. Definitions

```
progress_km      p          distance along the route direction from its first stop
remaining_km                route.distance_km - p           (to a stop: km(stop) - p)
progress_pct                100 * p / route.distance_km
sched(p)                    off[i] + f * (off[i+1] - off[i])  for the segment i holding p, f = fraction
elapsed_min                 now - scheduled_start             (and now - actual_start)
delay_min                   elapsed_min(scheduled) - sched(p) # + late, - early
scheduled_arrival(stop)     scheduled_start + scheduled_offset_min(stop)
```

The same definitions are used in [gps-scenarios.md §1](./gps-scenarios.md#1-simulation-model) and
by the validator. "Delayed" means `delay_min ≥ 5`, following `meta.thresholds`.

**Time band.** During a demo, take the band from `meta.demo_time_band`, not the wall clock.
Otherwise the same demo gives different ETAs at 09:00 and 15:00.

## 4. Data caveats

- **Estimated distances.** Straight line × detour factor, ±10–20%.
- **Simulated history.** The off-peak / peak values are not observations. Replace them with
  averages from recorded fixes once real runs exist; the trip table and GPS history are enough to
  compute them.
- **Noisy phone speeds.** Speeds from a phone fluctuate and read 0 at every signal. Smooth them
  (for example, the median of the last N fixes) before using them.
- **No live inputs when tracking is not `live`.** A stale or unavailable bus has no trustworthy
  speed or progress (scenario E sets them to `null`).

## 5. Candidate methods (not decided)

All four can be computed from the fields above:

| | Method | Minutes until the bus reaches stop S |
| --- | --- | --- |
| **M1** | Distance ÷ current speed | `(km(S) − p) / speed × 60` + dwell of the stops in between |
| **M1+fallback** | M1, but if speed < 5 km/h use the route's planning speed | as M1 |
| **M2** | Timetable + current delay | `off(S) − sched(p)`, i.e. the scheduled arrival + the current delay − now |
| **M3** | Historical segment times | `(1 − f) × hist(current segment) + Σ hist(following segments up to S)` for the active band |

The view `v_trip_stop_eta` on `main`, documented in [`docs/eta-data-design.md`](../eta-data-design.md),
is a variant of **M1+fallback**. It falls back only at exactly 0 km/h, adds a flat 0.5 min dwell per
stop, and since the GPS-freshness migration also returns `gps_status`. All its inputs exist here.
Because its fallback needs exactly 0 km/h, a bus crawling at 2 km/h (Demo 2) gets M1's spike of
about 66 min.

### Worked examples (minutes from "now")

"Scripted outcome" is what the scenario simulation actually does next.

| Case | Scripted outcome | M1 | M1+fallback | M2 | M3 off-peak |
| --- | --- | --- | --- | --- | --- |
| `TRIP-01` at T0 → Saddar | 10.0 | 10.0 | 10.0 | 10.0 | 10.5 |
| `TRIP-01` at T0 → University of Karachi | 58.0 | 69.0 | 69.0 | 58.0 | 56.6 |
| `TRIP-02` at T0 → Karsaz (crawling) | 8.0 | 8.0 | 8.0 | 4.9 | 5.1 |
| `TRIP-02` at T0 → Airport | 33.0 | 49.2 | 49.2 | 28.9 | 27.8 |
| Demo 2 mid-hold (t = 240 s, 2 km/h) → Saddar | 10.3 | **65.3** | 7.8 | 8.6 | 9.1 |
| Demo 2 just after the hold (t = 360 s) → Saddar | 8.3 | 8.3 | 8.3 | 8.3 | 8.8 |

What the examples show, without picking a winner:

- **M1 matches the scripted outcome for the next stop in current conditions** (the crawling bus
  to Karsaz). It breaks down when the speed is near 0 (65 min mid-hold) and for far stops, where the current
  speed isn't representative (69 vs 58 min).
- **M2 and M3 are steadier for far stops** but ignore congestion that is happening now (4.9–5.1
  vs 8.0 min to Karsaz).
- **M3 depends on the band.** With the `peak` band, `TRIP-01` → University of Karachi becomes
  88.3 min.
- **Caveat:** the scripted buses return to timetable pace after each disruption, so **M2 matches
  the scripted outcome by construction** in several rows. Don't read these numbers as evidence
  for M2.

## 6. Edge cases the chosen ETA must handle

| Case | Where in the data | Expected behaviour |
| --- | --- | --- |
| Bus stationary, speed 0 | Demo 2 hold; scenario D | no infinite or absurd ETA; the countdown may stall |
| GPS unavailable | scenario E after t = 510 s | **no live ETA**; show the timetable time labelled "Scheduled"; delay unknown |
| Trip not started | `TRIP-04` before t = 300 s | timetable time only, labelled "Scheduled" |
| Stop already passed | any stop with sequence ≤ the starting stop | no ETA for it |
| Bus at a stop / dwelling | scenario C, t = 76–136 s | "At stop" / "Due" rather than "0 min" |
| Early running | `HIST-05` ended −1 min; threshold `early` < −1.0 | never show a negative ETA |
| Inactive route | `ROUTE-04` | no ETAs; show `ALERT-02` |
| Inbound direction | `TRIP-03` | use the inbound `route_stops` and segments |
| End of route | progress = route distance | trip completes; no further ETAs |

## 7. Open decisions

- [ ] Method or blend, and when to switch (for example, M1 for the next stop when speed is
      reliable, M2/M3 beyond it).
- [ ] Whether delay persists or recovers through timetable slack.
- [ ] Time band source: the demo setting or the wall clock.
- [ ] Speed smoothing window for phone GPS.
- [ ] Projecting phone fixes onto the route (progress from raw GPS).
- [ ] Where historical segment times live in the final schema (the schema on `main` has no table for them).
- [ ] Display rules: "Due" under 1 min, rounding, and the "Scheduled" label when tracking is not
      live.
