/**
 * Generates data/karachi-demo-data.json and data/gps-scenarios.json from the SQL
 * that is actually applied.
 *
 *   node scripts/export-demo-data.mjs
 *
 * supabase/seed.sql stays the single source of truth; the JSON is derived, so
 * the two can never drift. Re-run this after editing the seed.
 *
 * Rows are keyed by natural keys (stop codes, route codes, registrations) rather
 * than UUIDs, because the UUIDs are generated fresh on every seed run.
 *
 * Trip and alert times are exported as offsets in minutes from the export
 * moment, not absolute timestamps, so a consumer (e.g. the GPS simulator) can
 * rebase them onto its own "now" instead of inheriting a stale clock.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');

const SQL_FILES = [
  'supabase/migrations/20261001120000_core_schema.sql',
  'supabase/migrations/20261001120100_functions_and_views.sql',
  'supabase/migrations/20261001120200_rls_policies.sql',
  'supabase/migrations/20261001130000_gps_freshness.sql',
  'supabase/migrations/20261001140000_auth_and_realtime.sql',
  'supabase/seed.sql',
];

const db = await PGlite.create();
await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $fn$ select null::uuid $fn$;
  do $do$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  end $do$;`);

for (const file of SQL_FILES) {
  await db.exec(await readFile(path.join(root, file), 'utf8'));
}

const rows = async (sql) => (await db.query(sql)).rows;

const profiles = await rows(`
  select full_name, email, phone, role::text
  from public.profiles order by role, full_name`);

const drivers = await rows(`
  select d.full_name, d.license_no, d.phone, d.status::text, d.rating::float8 as rating,
         p.email as profile_email
  from public.drivers d
  left join public.profiles p on p.id = d.profile_id
  order by d.license_no`);

const buses = await rows(`
  select b.registration_no, b.label, b.model, b.capacity, b.has_ac, b.status::text,
         d.license_no as assigned_driver_license_no
  from public.buses b
  left join public.drivers d on d.id = b.assigned_driver_id
  order by b.registration_no`);

const routes = await rows(`
  select code, name, description, color,
         distance_km::float8 as distance_km,
         avg_speed_kmh::float8 as avg_speed_kmh,
         expected_duration_min,
         fare_pkr::float8 as fare_pkr,
         headway_min,
         first_departure::text, last_departure::text,
         is_active
  from public.routes order by code`);

const stops = await rows(`
  select code, name, area, latitude::float8 as latitude, longitude::float8 as longitude, is_active
  from public.stops order by code`);

const routeStops = await rows(`
  select r.code as route_code, rs.direction::text, rs.stop_order, s.code as stop_code, s.name as stop_name,
         rs.distance_from_start_km::float8 as distance_from_start_km,
         rs.scheduled_offset_min, rs.is_major_stop
  from public.route_stops rs
  join public.routes r on r.id = rs.route_id
  join public.stops s on s.id = rs.stop_id
  order by r.code, rs.direction, rs.stop_order`);

const trips = await rows(`
  select
    t.trip_code,
    r.code as route_code,
    b.registration_no as bus_registration_no,
    d.license_no as driver_license_no,
    t.direction::text,
    t.status::text,
    round(extract(epoch from (t.scheduled_start_at - now())) / 60.0)::int as scheduled_start_offset_min,
    r.expected_duration_min,
    t.delay_minutes,
    t.progress_km::float8 as progress_km,
    t.last_stop_order,
    ns.code as next_stop_code,
    t.occupancy,
    t.notes,
    case t.trip_code
      when 'TRP-D1-0001' then 'ON_TIME'
      when 'TRP-D4-0001' then 'DELAYED'
      when 'TRP-D2-0001' then 'STOPPED'
      when 'TRP-D3-0001' then 'GPS_UNAVAILABLE'
      when 'TRP-D2-0002' then 'COMPLETED'
      else null
    end as demo_scenario
  from public.trips t
  join public.routes r on r.id = t.route_id
  join public.buses b on b.id = t.bus_id
  left join public.drivers d on d.id = t.driver_id
  left join public.stops ns on ns.id = t.next_stop_id
  order by t.trip_code`);

const latestLocations = await rows(`
  select
    b.registration_no as bus_registration_no,
    t.trip_code,
    round(extract(epoch from (now() - l.recorded_at)))::int as fix_age_seconds,
    l.latitude::float8 as latitude,
    l.longitude::float8 as longitude,
    l.speed_kmh::float8 as speed_kmh,
    l.heading_deg::float8 as heading_deg,
    l.progress_km::float8 as progress_km,
    l.source,
    case
      when l.recorded_at < now() - interval '3 minutes' then 'stale'
      else 'live'
    end as gps_status
  from public.v_bus_latest_location l
  join public.buses b on b.id = l.bus_id
  left join public.trips t on t.id = l.trip_id
  order by b.registration_no`);

const serviceAlerts = await rows(`
  select
    a.title, a.message, a.severity::text,
    r.code as route_code,
    b.registration_no as bus_registration_no,
    s.code as stop_code,
    round(extract(epoch from (a.starts_at - now())) / 60.0)::int as starts_offset_min,
    case when a.ends_at is not null
      then round(extract(epoch from (a.ends_at - now())) / 60.0)::int end as ends_offset_min,
    a.is_active
  from public.service_alerts a
  left join public.routes r on r.id = a.route_id
  left join public.buses b on b.id = a.bus_id
  left join public.stops s on s.id = a.stop_id
  order by a.starts_at desc`);

const dataset = {
  meta: {
    project: 'Smart Public Transport & Bus Tracking Platform - Karachi',
    data_classification: 'DEMO / SIMULATED HACKATHON DATA',
    disclaimer:
      'All routes, timetables, fares, headways, bus registrations, drivers, passengers, trips, '
      + 'delays and GPS positions in this file are INVENTED for a hackathon demonstration. They do '
      + 'not describe any real Karachi public transport service, operator, schedule or fare. Stop '
      + 'names and coordinates are approximate positions of real, well-known Karachi landmarks so '
      + 'that maps render believably; the stops themselves are demo constructs and no bus stop is '
      + 'claimed to exist at those points. Do not present any of this as verified official '
      + 'transport information.',
    generated_by: 'scripts/export-demo-data.mjs',
    generated_at: new Date().toISOString(),
    source_of_truth: 'supabase/seed.sql',
    keying: 'Rows reference each other by natural key (stop code, route code, registration, licence).',
    time_base:
      'Trip and alert times are offsets in minutes relative to the moment of export. Negative is '
      + 'in the past. Rebase them onto your own current time rather than treating them as absolute.',
    coordinates: 'WGS84 decimal degrees (latitude, longitude).',
    timezone: 'Asia/Karachi, UTC+05:00, no daylight saving.',
    counts: {
      profiles: profiles.length,
      drivers: drivers.length,
      buses: buses.length,
      routes: routes.length,
      stops: stops.length,
      route_stops: routeStops.length,
      trips: trips.length,
      latest_locations: latestLocations.length,
      service_alerts: serviceAlerts.length,
    },
  },
  profiles,
  drivers,
  buses,
  routes,
  stops,
  route_stops: routeStops,
  trips,
  latest_locations: latestLocations,
  service_alerts: serviceAlerts,
};

await mkdir(path.join(root, 'data'), { recursive: true });
const out = path.join(root, 'data', 'karachi-demo-data.json');
await writeFile(out, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');

console.log(`Wrote ${path.relative(root, out)}`);
console.table(dataset.meta.counts);

// ---------------------------------------------------------------------------
// data/gps-scenarios.json
// Scenario definitions are authored here; the coordinate ladders are computed
// from the seeded route geometry so the sample points are real, not invented.
// ---------------------------------------------------------------------------
const stopLadder = await rows(`
  select rs.stop_order, s.code as stop_code, s.name as stop_name,
         rs.distance_from_start_km::float8 as distance_from_start_km,
         rs.scheduled_offset_min,
         s.latitude::float8 as latitude, s.longitude::float8 as longitude
  from public.route_stops rs
  join public.routes r on r.id = rs.route_id
  join public.stops s on s.id = rs.stop_id
  where r.code = 'KHI-D1' and rs.direction = 'outbound'
  order by rs.stop_order`);

const interpolated = await rows(`
  select g.km::float8 as km,
         p.latitude::float8 as latitude,
         p.longitude::float8 as longitude,
         p.heading_deg::float8 as heading_deg
  from generate_series(0, 16, 2) as g(km)
  cross join lateral public.fn_route_point_at_km(
    (select id from public.routes where code = 'KHI-D1'), 'outbound', g.km) p
  order by g.km`);

const scenarios = {
  meta: {
    project: 'Smart Public Transport & Bus Tracking Platform - Karachi',
    data_classification: 'DEMO / SIMULATED HACKATHON DATA',
    purpose:
      'State definitions the GPS simulator and the UI need in order to demonstrate each tracking '
      + 'condition. This file defines data and expected behaviour only - the simulator itself is '
      + 'not implemented here.',
    generated_by: 'scripts/export-demo-data.mjs',
    generated_at: new Date().toISOString(),
    disclaimer: dataset.meta.disclaimer,
  },

  thresholds: {
    gps_stale_seconds: 180,
    vehicle_not_reporting_seconds: 600,
    delayed_threshold_minutes: 5,
    dwell_minutes_per_intermediate_stop: 0.5,
    note:
      'gps_stale_seconds drives v_active_trips.gps_status (passenger-facing: is the pin safe to '
      + 'draw as live). vehicle_not_reporting_seconds drives v_fleet_status.telemetry_stale '
      + '(operator-facing: has this vehicle stopped reporting).',
  },

  simulation_contract: {
    tick_seconds: 5,
    position_source:
      "select * from fn_route_point_at_km(route_id, direction, progress_km) - returns the "
      + 'interpolated latitude, longitude and bearing at any distance along the route.',
    advance_formula: 'progress_km += speed_kmh * (tick_seconds / 3600)',
    writes_per_tick: [
      'insert into bus_locations (bus_id, trip_id, recorded_at, latitude, longitude, speed_kmh, heading_deg, progress_km, source)',
      'update trips set progress_km, last_stop_order, next_stop_id, delay_minutes',
    ],
    derive_stop_pointers:
      'last_stop_order = max(stop_order) where distance_from_start_km <= progress_km; '
      + 'next_stop_id = the stop at last_stop_order + 1. Never store these independently of progress_km.',
    end_condition:
      'progress_km >= routes.distance_km -> set trips.status = completed, actual_end_at = now(), '
      + 'next_stop_id = null, buses.status = idle, and stop emitting fixes.',
    source_column:
      "bus_locations.source distinguishes the feed: 'device' for real browser geolocation, "
      + "'simulated' for the demo simulator, 'manual' for operator corrections.",
  },

  scenarios: [
    {
      name: 'ON_TIME',
      demo_trip_code: 'TRP-D1-0001',
      trip_status: 'in_progress',
      required_state: {
        'trips.status': 'in_progress',
        'trips.delay_minutes': 'between -4 and 4',
        'trips.progress_km': 'advancing every tick',
        'bus_locations.speed_kmh': '0.8 to 1.0 x routes.avg_speed_kmh',
        'bus_locations.recorded_at': 'fresh, newer than gps_stale_seconds',
        'buses.status': 'active',
      },
      expected_ui: [
        'Bus pin moves along the route polyline.',
        'ETA counts down as progress increases.',
        'Status badge reads "On time".',
      ],
    },
    {
      name: 'DELAYED',
      demo_trip_code: 'TRP-D4-0001',
      trip_status: 'in_progress',
      required_state: {
        'trips.status': 'in_progress',
        'trips.delay_minutes': '>= 5 (seed value 6; TRP-D2-0001 carries 14)',
        'bus_locations.speed_kmh': '0.4 to 0.6 x routes.avg_speed_kmh',
        'bus_locations.recorded_at': 'fresh',
        'buses.status': 'active',
      },
      detection:
        'v_active_trips.is_delayed, v_fleet_status.is_delayed, and '
        + 'v_trip_stop_eta.projected_delay_minutes > 0.',
      expected_ui: [
        'Amber "Delayed" badge with the minutes late.',
        'Estimated arrival is later than the scheduled arrival.',
        'Trip appears in the operator delayed list.',
        'A matching service_alerts row explains the cause to passengers.',
      ],
    },
    {
      name: 'STOPPED',
      demo_trip_code: 'TRP-D2-0001',
      trip_status: 'in_progress',
      required_state: {
        'trips.status': 'in_progress',
        'trips.progress_km': 'unchanged between ticks',
        'bus_locations.speed_kmh': '0',
        'bus_locations.recorded_at': 'fresh - fixes keep arriving',
        'trips.delay_minutes': 'growing',
      },
      distinction:
        'The bus is reporting but not moving. Fixes continue, so gps_status stays "live". This is '
        + 'the opposite of GPS_UNAVAILABLE, where the bus may be moving but is not reporting.',
      eta_behaviour:
        'The ETA view uses nullif(speed_kmh, 0), so a zero speed falls back to '
        + 'routes.avg_speed_kmh instead of producing an infinite estimate.',
      expected_ui: [
        'Pin stays put but is still shown as live.',
        'ETA is computed from the route planning speed, not from 0 km/h.',
        'Delay grows while the bus is held.',
      ],
    },
    {
      name: 'GPS_UNAVAILABLE',
      demo_trip_code: 'TRP-D3-0001',
      trip_status: 'in_progress',
      required_state: {
        'trips.status': 'in_progress - the trip has NOT ended',
        'bus_locations': 'no new rows; the newest fix ages past gps_stale_seconds',
        'trips.progress_km': 'frozen at the last known value',
        'v_active_trips.gps_status': 'stale (or no_fix if the bus never reported)',
      },
      detection:
        'v_active_trips.gps_status / location_is_stale (3 min) for passengers; '
        + 'v_fleet_status.telemetry_stale (10 min) for the operator.',
      expected_ui: [
        'Show "Location temporarily unavailable".',
        'Do NOT animate or extrapolate the pin - grey it out or hide it.',
        'Do NOT present the ETA as live; label it as a last-known estimate or hide it.',
        'Show the last update time so the user knows how old the information is.',
      ],
      anti_requirement:
        'The system must not invent a position. Every live view exposes gps_status precisely so '
        + 'that a stale fix is never rendered as current.',
    },
    {
      name: 'COMPLETED',
      demo_trip_code: 'TRP-D2-0002',
      trip_status: 'completed',
      required_state: {
        'trips.status': 'completed',
        'trips.actual_end_at': 'set',
        'trips.progress_km': '= routes.distance_km',
        'trips.next_stop_id': 'null',
        'trips.last_stop_order': 'the final stop_order of the route direction',
        'trip_stop_times.status': 'arrived for every stop',
        'buses.status': 'idle',
      },
      expected_ui: [
        'Trip disappears from the live map (v_active_trips filters on in_progress).',
        'Tracking stops; no further fixes are written.',
        'Trip remains queryable as history and counts toward analytics.',
      ],
    },
  ],

  transitions: {
    start_trip:
      "Driver action: update trips set status = 'in_progress', actual_start_at = now() where id = $1; "
      + "update buses set status = 'active' where id = $2. This is how demo 2 begins - "
      + 'TRP-D1-0002 is seeded as scheduled for exactly this purpose.',
    end_trip:
      "update trips set status = 'completed', actual_end_at = now(), progress_km = <route distance>, "
      + "next_stop_id = null; update buses set status = 'idle'.",
    report_problem:
      'Driver action: update trips set delay_minutes, notes; optionally insert a service_alerts row '
      + 'scoped to the route or bus.',
  },

  example_route_walk: {
    route_code: 'KHI-D1',
    direction: 'outbound',
    note:
      'The stop ladder a simulator walks through, and a sample of intermediate coordinates between '
      + 'the stops. Both are computed from the seeded geometry, not hand-written. Interpolation is '
      + 'straight-line between consecutive stops, so positions are not road-snapped.',
    stops: stopLadder,
    interpolated_every_2km: interpolated,
  },
};

const scenarioOut = path.join(root, 'data', 'gps-scenarios.json');
await writeFile(scenarioOut, `${JSON.stringify(scenarios, null, 2)}\n`, 'utf8');
console.log(`Wrote ${path.relative(root, scenarioOut)} (${scenarios.scenarios.length} scenarios)`);

await db.close();
