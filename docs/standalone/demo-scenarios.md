# Demo scenarios for judging

> **DEMO / SIMULATED HACKATHON DATA.** Say so on screen and out loud. The routes (`DEMO-1` …
> `DEMO-4`), timetables, buses, drivers and delays are invented. Stops are approximate positions of
> real Karachi landmarks, not official bus stops. Do not present any of it as real Karachi
> transport information. See [demo-data.md](./demo-data.md).

> This judging script runs on the **standalone** dataset. Member 1's
> [`docs/demo-scenarios.md`](../demo-scenarios.md) describes demos on the seed-derived
> `data/karachi-demo-data.json`. The two use different routes and IDs, so follow one of them.

Five deterministic demos built on [`data/standalone/karachi-demo-data.json`](../../data/standalone/karachi-demo-data.json).
Each demo's trigger and expected outcome is also stored in `demo_stories`, and
`node scripts/validate-standalone-data.mjs` checks that every number below follows from the data. Times
are relative to **T0**, when the data is loaded. Clock times in brackets assume T0 = 11:00.

## Before presenting

1. Re-seed with **T0 = now**. All offsets are relative, so re-seeding resets every bus to its
   starting position.
2. Start the simulator from the T0 state, or have manual triggers ready for Demos 2–4.
3. Open three screens: passenger app (search and map), operator dashboard and, optionally, the
   driver app on a phone.
4. Check that the **"Demo data"** badge is visible.
5. If the JSON was edited, run `node scripts/validate-standalone-data.mjs`.

## Cast

| Who | Role in the story |
| --- | --- |
| Passenger | Waiting at **Saddar** ("City Centre"), going to **University of Karachi** |
| Bus 201 (`BUS-01`), driver Asad Mehmood | `TRIP-01` on DEMO-1, on time at T0, about to get stuck in traffic |
| Bus 204 (`BUS-04`), driver Shahzad Baloch | `TRIP-04` on DEMO-1, waiting at Merewether Tower, departs T0+5 |
| Bus 202 (`BUS-02`) | Background: already delayed on DEMO-2 near Karsaz |
| Bus 203 (`BUS-03`) | Background: approaching Teen Talwar, then stopped for 2 min (still live) |
| Bus 205 / 206 / 207 | Background: offline, in maintenance, idle spare |

## Running order (about 10 minutes)

| T0 + | What happens | Demo |
| --- | --- | --- |
| 0:00 | Passenger searches "City Centre → University" | 1 |
| 1:00 | Trigger the traffic hold on Bus 201 | 2 |
| 4:24 | Bus 201 flips to **Delayed** on both screens | 2 |
| 5:00 | Driver starts trip on Bus 204 | 3 |
| 7:00 | Bus 204's phone loses GPS | 4 |
| 8:30 | "Location temporarily unavailable" | 4 |
| 10:00 | GPS restored; finish on the operator dashboard and analytics | 4, 5 |

If you trigger by hand instead, the outcomes stay the same **relative to each trigger**.

---

## DEMO 1: Passenger searches "City Centre → University"

**Trigger.** In the passenger app, type *City Centre* → *University* (`demo_stories[0]`).

**Expected**

- "City Centre" resolves to **Saddar (Empress Market)** (`STOP-02`) through its alias.
- "University" matches **two** stops: NED University (`STOP-08`) and University of Karachi
  (`STOP-09`). Pick University of Karachi. Ambiguity is handled, not guessed.
- **Route found.** DEMO-1 (`ROUTE-01`, outbound), boarding at stop 2 and alighting at stop 9: 6
  stops in between, **13.8 km, 48 min** by timetable.
- **Bus found and moving.** Bus 201 is live on M.A. Jinnah Road, **2.5 km before Saddar**,
  "On time" (+2 min).
- **ETA shown.** Bus 201 at Saddar in about **10 min** [11:10], from timetable T0+8 plus the 2 min
  delay. All candidate ETA methods agree at this point (10.0–10.5 min; see
  [eta-data-spec.md](./eta-data-spec.md)). Arrival at University of Karachi is about T0+58.
- **Next departure.** Bus 204 leaves Tower at T0+5 and reaches Saddar at T0+22, labelled
  **"Scheduled"** because it is not live yet.
- **Not returned.** DEMO-2 and DEMO-3 (they do not reach the university) and DEMO-4 (inactive).

**Bonus.** Search *Tower → Sea View*. No active route serves it, because DEMO-4 is inactive.
The app should show `ALERT-02`: "DEMO-4 Tower - Sea View is not running today … take DEMO-3".

**Say.** "Search is stop-alias based, so 'City Centre' and 'University' work as people actually
say them, and the live bus comes with its punctuality."

---

## DEMO 2: A bus becomes delayed

**Setup.** The passenger is still watching Bus 201 heading to Saddar, and the operator dashboard
is open.

**Trigger.** At T0+60 s (or by hand), Bus 201 is held in traffic on M.A. Jinnah Road: **2 km/h
for 300 s**, then normal pace (`demo_stories[1].trigger.motion_override`).

| After trigger | Delay | Bus 201 shows | Operator |
| --- | --- | --- | --- |
| 0 s | +2.0 | On time, stopped (still live) | 1 delayed trip (Bus 202) |
| 120 s | +3.7 | On time, stopped | unchanged |
| **204 s** | **+5.0** | **Delayed +5 min** | BUS-01 turns amber/red; **delayed trips 1 → 2** |
| 300 s | +6.3 | Delayed +6 min, moving again | stays delayed |

**Expected**

- **Passenger sees the delay.** The label changes to "Delayed" with minutes, and Bus 201's Saddar
  arrival moves from about T0+10 to about **T0+14.3**.
- **The ETA changes.** While the bus is held, the countdown stalls, because the bus is not moving.
  It must not jump to an absurd value. Naive distance ÷ current speed would say 65 min mid-hold
  (see [eta-data-spec.md](./eta-data-spec.md)).
- **Operator sees the delayed status** as soon as the delay reaches +5.0.
- **Optional.** The operator publishes `ALERT-06` ("Congestion on M.A. Jinnah Road"), and it
  appears on DEMO-1 for passengers.

**Say.** "Delay is measured against the timetable at the bus's actual position, and a stopped bus
stays live: we never call it offline."

---

## DEMO 3: Driver starts trip

**Setup.** `TRIP-04` is `scheduled` with departure at T0+5 from Merewether Tower. Bus 204 is
`idle` and driver `DRV-04` is on duty.

**Trigger.** At T0+5 min, the driver taps **Start trip** in the driver app (`demo_stories[2]`).
If the app or phone GPS isn't ready, the simulator starts it at the same moment with
`gps_source: simulated`.

**Expected**

- **Trip becomes active.** `scheduled` → `in_progress`, with actual start T0+5, so it is on time
  (delay 0).
- **Bus status.** `idle` → `active`. Operator: trips in progress go from 3 to 4.
- **GPS starts updating** every 5 s from Tower: about 0.25 km per minute (24.84962, 66.99933 after
  1 min).
- **The passenger map reflects the movement.** Bus 204 appears at Merewether Tower and moves along
  M.A. Jinnah Road. On the Saddar board, Bus 204 switches from "Scheduled" to a live ETA.

**Say.** "A trip only becomes live when the driver starts it. Before that, passengers see a
clearly labelled timetable time."

---

## DEMO 4: Driver GPS disconnects

**Setup.** `TRIP-04` is running (Demo 3).

**Trigger.** At T0+7 min the driver's phone stops reporting (airplane mode, or the simulator
outage in `GPS-E`). The last fix is 0.506 km out of Tower at 24.85035, 67.00126.

| After last fix | Passenger | Operator |
| --- | --- | --- |
| 0–30 s | Marker **stays** at the last fix; it does not keep moving | normal |
| 30–90 s | Marker greyed, "Last updated N s ago" | GPS stale warning |
| > 90 s | **"Location temporarily unavailable"**; ETAs shown as **"Scheduled"** (Saddar T0+22) | "GPS signal lost · last seen N min ago"; trip still **in progress** |
| Restored (T0+10) | Marker **jumps** to 24.85252, 67.00705 (1.265 km); live again | GPS OK |

**Must not happen**

- Marker drifting along the route.
- A live-looking ETA countdown.
- The trip being cancelled.
- Invented points back-filling the gap after restore.

**Say.** "We never show fake live data. When we don't know where the bus is, we say so and fall
back to the timetable, clearly labelled."

---

## DEMO 5: Operator monitoring and analytics (wrap-up)

At T0 the dashboard should show (`demo_stories[4]`):

| Metric | T0 | After Demos 2–4 |
| --- | --- | --- |
| Fleet | 7 = 3 in service · 2 idle · 1 offline · 1 maintenance | 4 in service · 1 idle |
| Trips in progress / delayed / upcoming | 3 / 1 / 1 | 4 / 2 / 0 |
| Alerts | 3 active (one operator-only, `ALERT-03` about Bus 205) · 1 scheduled · 1 expired · 1 draft | + `ALERT-06` if published |
| Exceptions | Bus 205 offline 2 h 50 min; Bus 206 has no location data | + Bus 204 GPS lost, then restored |

Analytics from `trip_history` (earlier today):

- 5 completed and 1 cancelled trip (`HIST-06`, vehicle withdrawn).
- **3 of 5 on time** (60%), average end delay **+4.2 min**.
- By route: DEMO-1 +2 and +11 (avg 6.5) · DEMO-2 +8 and +1 (avg 4.5, plus 1 cancelled) ·
  DEMO-3 −1.

---

## If something goes wrong

| Problem | Fallback |
| --- | --- |
| Simulator not ready | Seed the T0 state and walk the dashboard (all scenarios A–E are visible at T0). Insert the checkpoint positions from `gps_scenarios` by hand to "advance" a bus. |
| Phone gets no GPS indoors | Run Demo 3 with simulated fixes (`GPS-E`'s motion), and say so. |
| Ran out of time | Demo 1 → Demo 4 is the most convincing pair: live tracking plus honest handling of lost GPS. |
| State drifted after rehearsals | Re-seed with a new T0. |
