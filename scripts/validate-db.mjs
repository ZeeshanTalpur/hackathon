/**
 * Runs the Supabase migrations and the demo seed against an in-process
 * Postgres (PGlite) and asserts the data-layer invariants.
 *
 *   npm i -D @electric-sql/pglite
 *   node scripts/validate-db.mjs
 *
 * Set PGLITE_MODULE to a file: URL if the package lives outside this project.
 *
 * PGlite has no Supabase auth schema and no API roles, so the harness creates
 * stubs for auth.uid() / auth.role() and the anon, authenticated and
 * service_role roles before applying the RLS migration.
 */
import { readFile } from 'node:fs/promises';
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
  'supabase/migrations/20261001150000_trip_control.sql',
  'supabase/migrations/20261001160000_simulation_elapsed.sql',
  'supabase/seed.sql',
];

const EXPECTED_COUNTS = {
  profiles: 10,
  drivers: 8,
  buses: 10,
  stops: 31,
  routes: 5,
  route_stops: 66,
  trips: 10,
  trip_stop_times: 78,
  bus_locations: 38,
  service_alerts: 7,
};

const failures = [];
let checks = 0;

function check(name, condition, detail = '') {
  checks += 1;
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    console.log(`  FAIL  ${name}${detail ? ` - ${detail}` : ''}`);
    failures.push(name);
  }
}

const db = await PGlite.create();

await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $fn$ select null::uuid $fn$;
  create or replace function auth.role() returns text language sql stable as $fn$ select 'anon'::text $fn$;
  do $do$
  begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
  end
  $do$;
`);

console.log('Applying SQL files');
for (const file of SQL_FILES) {
  const sql = await readFile(path.join(root, file), 'utf8');
  try {
    await db.exec(sql);
    console.log(`  OK    ${file}`);
  } catch (error) {
    console.log(`  ERROR ${file}`);
    console.error(error.message);
    process.exit(1);
  }
}

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const all = async (sql, params) => (await db.query(sql, params)).rows;

console.log('\nRow counts');
for (const [table, expected] of Object.entries(EXPECTED_COUNTS)) {
  const row = await one(`select count(*)::int as n from public.${table}`);
  check(`${table} = ${expected}`, row.n === expected, `got ${row.n}`);
}

console.log('\nSchema objects');
const tables = await one(`
  select count(*)::int as n from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'`);
check('10 base tables', tables.n === 10, `got ${tables.n}`);

const views = await one(`
  select count(*)::int as n from information_schema.views where table_schema = 'public'`);
check('7 views', views.n === 7, `got ${views.n}`);

const enums = await one(`
  select count(*)::int as n from pg_type t
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public' and t.typtype = 'e'`);
check('7 enum types', enums.n === 7, `got ${enums.n}`);

const rlsOff = await all(`
  select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
check('RLS enabled on every table', rlsOff.length === 0, rlsOff.map((r) => r.relname).join(', '));

console.log('\nRoute and stop integrity');
const badTail = await all(`
  select r.code
  from public.routes r
  join public.route_stops rs on rs.route_id = r.id and rs.direction = 'outbound'
  group by r.code, r.expected_duration_min, r.distance_km
  having max(rs.scheduled_offset_min) <> r.expected_duration_min
      or max(rs.distance_from_start_km) <> r.distance_km`);
check('last outbound stop matches route distance and duration',
  badTail.length === 0, badTail.map((r) => r.code).join(', '));

const nonMonotonic = await all(`
  select rs.route_id, rs.direction, rs.stop_order
  from public.route_stops rs
  join public.route_stops prev
    on prev.route_id = rs.route_id
   and prev.direction = rs.direction
   and prev.stop_order = rs.stop_order - 1
  where rs.distance_from_start_km <= prev.distance_from_start_km
     or rs.scheduled_offset_min <= prev.scheduled_offset_min`);
check('distance and offsets increase along every route', nonMonotonic.length === 0,
  `${nonMonotonic.length} bad pairs`);

const gaps = await all(`
  select route_id, direction
  from public.route_stops
  group by route_id, direction
  having max(stop_order) <> count(*) or min(stop_order) <> 1`);
check('stop_order is a gapless 1..n sequence', gaps.length === 0, `${gaps.length} bad sequences`);

const orphanStops = await one(`
  select count(*)::int as n from public.stops s
  where not exists (select 1 from public.route_stops rs where rs.stop_id = s.id)`);
check('every stop is used by a route', orphanStops.n === 0, `${orphanStops.n} unused`);

const outOfBounds = await one(`
  select count(*)::int as n from public.stops
  where latitude not between 24.6 and 25.2 or longitude not between 66.8 and 67.4`);
check('all stops inside the Karachi bounding box', outOfBounds.n === 0, `${outOfBounds.n} outside`);

const inbound = await one(`
  select count(*)::int as n from public.route_stops where direction = 'inbound'`);
check('20 inbound route_stops (D1 + D2)', inbound.n === 20, `got ${inbound.n}`);

console.log('\nDemo scenario coverage');
const scenario = await one(`
  select
    (select count(*)::int from public.trips where status = 'in_progress') as active_trips,
    (select count(*)::int from public.trips where status = 'in_progress' and delay_minutes >= 5) as delayed,
    (select count(*)::int from public.trips where status = 'in_progress' and delay_minutes < 0) as early,
    (select count(*)::int from public.trips where status = 'scheduled') as scheduled,
    (select count(*)::int from public.trips where status = 'completed') as completed,
    (select count(*)::int from public.trips where status = 'cancelled') as cancelled,
    (select count(*)::int from public.buses where status = 'offline') as offline_buses,
    (select count(*)::int from public.buses where status = 'maintenance') as maintenance_buses,
    (select count(*)::int from public.buses where status = 'idle') as idle_buses,
    (select count(*)::int from public.v_fleet_status where telemetry_stale) as stale_telemetry,
    (select count(distinct route_id)::int from public.trips where status = 'in_progress') as routes_live`);
check('4 trips in progress', scenario.active_trips === 4, JSON.stringify(scenario));
check('at least one delayed trip', scenario.delayed >= 1, `got ${scenario.delayed}`);
check('at least one early trip', scenario.early >= 1, `got ${scenario.early}`);
check('scheduled / completed / cancelled trips present',
  scenario.scheduled >= 1 && scenario.completed >= 1 && scenario.cancelled >= 1);
check('3 completed trips for analytics', scenario.completed === 3, `got ${scenario.completed}`);
check('offline, maintenance and idle buses present',
  scenario.offline_buses >= 1 && scenario.maintenance_buses >= 1 && scenario.idle_buses >= 1);
check('stale telemetry detected for parked buses', scenario.stale_telemetry >= 3,
  `got ${scenario.stale_telemetry}`);
check('live trips span multiple routes', scenario.routes_live >= 3, `got ${scenario.routes_live}`);

console.log('\nTrip state consistency');
const progressOverrun = await one(`
  select count(*)::int as n from public.trips t
  join public.routes r on r.id = t.route_id
  where t.progress_km > r.distance_km`);
check('no trip has progressed past the end of its route', progressOverrun.n === 0);

const badNextStop = await one(`
  select count(*)::int as n from public.trips t
  where t.status = 'in_progress'
    and (t.next_stop_id is null
         or not exists (
           select 1 from public.route_stops rs
           where rs.route_id = t.route_id and rs.direction = t.direction
             and rs.stop_id = t.next_stop_id and rs.stop_order = t.last_stop_order + 1))`);
check('next_stop_id follows last_stop_order on every live trip', badNextStop.n === 0);

const locOffRoute = await one(`
  select count(*)::int as n from public.bus_locations
  where latitude not between 24.6 and 25.2 or longitude not between 66.8 and 67.4`);
check('all GPS fixes inside the Karachi bounding box', locOffRoute.n === 0, `${locOffRoute.n} outside`);

const noFix = await one(`
  select count(*)::int as n from public.buses b
  where not exists (select 1 from public.bus_locations l where l.bus_id = b.id)`);
check('every bus has at least one location fix', noFix.n === 0, `${noFix.n} without`);

const liveNoTrail = await one(`
  select count(*)::int as n from public.trips t
  where t.status = 'in_progress'
    and (select count(*) from public.bus_locations l where l.trip_id = t.id) <> 8`);
check('each live trip has an 8-point trail', liveNoTrail.n === 0);

const servedMismatch = await one(`
  select count(*)::int as n from public.trip_stop_times tst
  join public.trips t on t.id = tst.trip_id
  where t.status = 'in_progress'
    and ((tst.stop_order <= t.last_stop_order and tst.status <> 'arrived')
      or (tst.stop_order >  t.last_stop_order and tst.status <> 'pending'))`);
check('trip_stop_times arrival flags match trip progress', servedMismatch.n === 0);

console.log('\nETA and search functions');
const etaRows = await all(`select * from public.v_trip_stop_eta order by trip_id, stop_order`);
check('ETA view returns rows for live trips', etaRows.length > 0, `${etaRows.length} rows`);
check('every ETA is a non-negative integer',
  etaRows.every((r) => Number.isInteger(r.eta_minutes) && r.eta_minutes >= 0));
check('ETAs increase along the remaining stops of a trip', (() => {
  const byTrip = new Map();
  for (const r of etaRows) {
    const prev = byTrip.get(r.trip_id);
    if (prev !== undefined && r.eta_minutes < prev) return false;
    byTrip.set(r.trip_id, r.eta_minutes);
  }
  return true;
})());

const etaCoverage = await one(`
  select count(*)::int as n from public.trips t
  where t.status = 'in_progress'
    and not exists (select 1 from public.v_trip_stop_eta e where e.trip_id = t.id)`);
check('every live trip has at least one upcoming-stop ETA', etaCoverage.n === 0);

const delayedEta = await one(`
  select e.eta_minutes, e.projected_delay_minutes
  from public.v_trip_stop_eta e
  join public.trips t on t.id = e.trip_id
  where t.trip_code = 'TRP-D2-0001'
  order by e.stop_order limit 1`);
check('delayed trip reports a positive projected delay',
  delayedEta && delayedEta.projected_delay_minutes > 0,
  JSON.stringify(delayedEta));

const scalarEta = await one(`
  select public.fn_trip_eta_minutes(t.id, t.next_stop_id) as eta
  from public.trips t where t.trip_code = 'TRP-D1-0001'`);
check('fn_trip_eta_minutes resolves the next stop', scalarEta.eta !== null,
  JSON.stringify(scalarEta));

const arrivals = await all(`
  select * from public.fn_stop_arrivals((select id from public.stops where code = 'ST-KSZ'), 5)`);
check('fn_stop_arrivals lists buses heading to Karsaz', arrivals.length >= 1,
  `${arrivals.length} arrivals`);

const direct = await all(`
  select * from public.fn_search_routes(
    (select id from public.stops where code = 'ST-SDR'),
    (select id from public.stops where code = 'ST-MLM'))`);
check('route search finds Saddar -> Millennium Mall', direct.length >= 1,
  `${direct.length} results`);
check('route search returns a positive journey time and distance',
  direct.length > 0 && direct[0].estimated_duration_min > 0 && Number(direct[0].distance_km) > 0,
  JSON.stringify(direct[0]));

const multi = await all(`
  select * from public.fn_search_routes(
    (select id from public.stops where code = 'ST-SDR'),
    (select id from public.stops where code = 'ST-TWR'))`);
check('route search finds more than one option for Saddar -> Tower', multi.length >= 2,
  `${multi.length} results`);

const reverse = await all(`
  select * from public.fn_search_routes(
    (select id from public.stops where code = 'ST-MLM'),
    (select id from public.stops where code = 'ST-SDR'))`);
check('route search respects direction (Millennium Mall -> Saddar has no D2 outbound)',
  reverse.every((r) => r.direction !== 'outbound' || r.route_code !== 'KHI-D2'),
  JSON.stringify(reverse.map((r) => `${r.route_code}/${r.direction}`)));

const nearby = await all(`select * from public.fn_nearby_stops(24.8607, 67.0099, 3, 10)`);
check('nearby stop search returns Saddar first', nearby[0]?.code === 'ST-SDR',
  JSON.stringify(nearby[0]));

const haversine = await one(`select public.fn_haversine_km(24.8607, 67.0099, 24.8503, 66.9968) as km`);
check('haversine distance Saddar -> Tower is ~1.8 km',
  Number(haversine.km) > 1.5 && Number(haversine.km) < 2.2, `${haversine.km} km`);

console.log('\nGPS freshness (demo scenario 4)');
const gps = await all(`
  select trip_code, gps_status, location_is_stale, speed_kmh, elapsed_minutes,
         round(extract(epoch from location_age) / 60)::int as fix_age_min
  from public.v_active_trips order by trip_code`);
check('exactly one live trip reports stale GPS',
  gps.filter((r) => r.gps_status === 'stale').length === 1,
  JSON.stringify(gps.map((r) => `${r.trip_code}:${r.gps_status}`)));
check('the other three live trips report fresh GPS',
  gps.filter((r) => r.gps_status === 'live').length === 3);
check('the stale trip is TRP-D3-0001 and its fix is over 10 minutes old',
  gps.find((r) => r.gps_status === 'stale')?.trip_code === 'TRP-D3-0001'
    && gps.find((r) => r.gps_status === 'stale')?.fix_age_min >= 10,
  JSON.stringify(gps.find((r) => r.gps_status === 'stale')));
check('location_is_stale agrees with gps_status',
  gps.every((r) => r.location_is_stale === (r.gps_status !== 'live')));
check('elapsed_minutes is positive for every live trip',
  gps.every((r) => r.elapsed_minutes > 0), JSON.stringify(gps.map((r) => r.elapsed_minutes)));
check('a stationary bus is represented (speed 0 with a fresh fix)',
  gps.some((r) => Number(r.speed_kmh) === 0 && r.gps_status === 'live'));

const arrivalGps = await all(`
  select * from public.fn_stop_arrivals((select id from public.stops where code = 'ST-PWH'), 5)`);
check('fn_stop_arrivals exposes gps_status so the UI can label estimates',
  arrivalGps.length > 0 && arrivalGps.every((r) => typeof r.gps_status === 'string'),
  JSON.stringify(arrivalGps.map((r) => `${r.route_code}:${r.gps_status}`)));

console.log('\nRoute status');
const routeStatus = await one(`
  select count(*) filter (where is_active)::int as active,
         count(*) filter (where not is_active)::int as suspended
  from public.routes`);
check('dataset has both active and suspended routes',
  routeStatus.active === 4 && routeStatus.suspended === 1, JSON.stringify(routeStatus));

const suspendedSearch = await all(`
  select * from public.fn_search_routes(
    (select id from public.stops where code = 'ST-KRC'),
    (select id from public.stops where code = 'ST-TWR'))`);
check('journey search excludes the suspended route (Korangi -> Tower is D5 only)',
  suspendedSearch.length === 0, `${suspendedSearch.length} results`);

const suspendedTrip = await one(`
  select count(*)::int as n from public.trips t
  join public.routes r on r.id = t.route_id
  where not r.is_active and t.status in ('scheduled', 'in_progress')`);
check('no live or upcoming trip sits on a suspended route', suspendedTrip.n === 0);

console.log('\nAnalytics derivability (part 9)');
const analytics = await one(`
  select
    count(*)::int as completed_trips,
    count(distinct route_id)::int as routes_covered,
    count(distinct driver_id)::int as drivers_covered,
    round(avg(delay_minutes), 1) as avg_delay_minutes,
    round(avg(extract(epoch from (actual_end_at - actual_start_at)) / 60.0), 1) as avg_duration_min
  from public.trips where status = 'completed'`);
check('average delay is derivable from completed trips',
  analytics.avg_delay_minutes !== null, JSON.stringify(analytics));
check('average trip duration is derivable from completed trips',
  Number(analytics.avg_duration_min) > 0, JSON.stringify(analytics));
check('completed trips span multiple routes and drivers',
  analytics.routes_covered >= 2 && analytics.drivers_covered >= 2, JSON.stringify(analytics));

const endTimes = await one(`
  select count(*)::int as n from public.trips
  where status = 'completed' and (actual_start_at is null or actual_end_at is null)`);
check('every completed trip has actual start and end times', endTimes.n === 0);

const cancelledTimetable = await one(`
  select count(*)::int as n from public.trip_stop_times tst
  join public.trips t on t.id = tst.trip_id where t.status = 'cancelled'`);
check('cancelled trips carry no timetable rows', cancelledTimetable.n === 0);

const stopUsage = await all(`
  select s.code, count(*)::int as trips
  from public.trip_stop_times tst
  join public.stops s on s.id = tst.stop_id
  group by s.code order by trips desc limit 1`);
check('most-used stop is derivable', stopUsage.length === 1 && stopUsage[0].trips > 0,
  JSON.stringify(stopUsage[0]));

console.log('\nDashboard views');
const overview = await one(`select * from public.v_fleet_overview`);
check('fleet overview totals are consistent',
  overview.total_buses === 10 && overview.trips_in_progress === 4
    && overview.active_alerts === 6 && overview.active_routes === 4,
  JSON.stringify(overview));

const activeTrips = await all(`select * from public.v_active_trips`);
check('v_active_trips returns 4 rows with coordinates', activeTrips.length === 4
  && activeTrips.every((t) => t.latitude !== null && t.longitude !== null));
check('v_active_trips progress percentages are within 0-100',
  activeTrips.every((t) => Number(t.progress_pct) >= 0 && Number(t.progress_pct) <= 100));
check('v_active_trips occupancy never exceeds capacity',
  activeTrips.every((t) => Number(t.occupancy_pct) <= 100));

const fleet = await all(`select * from public.v_fleet_status`);
check('v_fleet_status has one row per bus', fleet.length === 10, `got ${fleet.length}`);

const summary = await all(`select * from public.v_route_summary order by code`);
check('v_route_summary covers 5 routes with endpoints', summary.length === 5
  && summary.every((r) => r.origin_stop_name && r.destination_stop_name));
check('v_route_summary reports live trips on D1', summary.find((r) => r.code === 'KHI-D1')
  ?.active_trip_count === 1);

const latest = await all(`select * from public.v_bus_latest_location`);
check('v_bus_latest_location has one row per bus', latest.length === 10, `got ${latest.length}`);

console.log('\nJSON dataset (data/karachi-demo-data.json)');
let ds = null;
try {
  ds = JSON.parse(await readFile(path.join(root, 'data', 'karachi-demo-data.json'), 'utf8'));
} catch {
  check('data/karachi-demo-data.json exists', false, 'run node scripts/export-demo-data.mjs');
}

if (ds) {
  const dbCounts = {
    profiles: EXPECTED_COUNTS.profiles,
    drivers: EXPECTED_COUNTS.drivers,
    buses: EXPECTED_COUNTS.buses,
    routes: EXPECTED_COUNTS.routes,
    stops: EXPECTED_COUNTS.stops,
    route_stops: EXPECTED_COUNTS.route_stops,
    trips: EXPECTED_COUNTS.trips,
    service_alerts: EXPECTED_COUNTS.service_alerts,
  };
  check('JSON row counts match the database',
    Object.entries(dbCounts).every(([k, v]) => ds[k].length === v),
    JSON.stringify(Object.fromEntries(Object.entries(dbCounts)
      .filter(([k, v]) => ds[k].length !== v)
      .map(([k, v]) => [k, `json ${ds[k].length} vs db ${v}`]))));

  check('JSON is labelled as demo data',
    ds.meta.data_classification === 'DEMO / SIMULATED HACKATHON DATA'
      && /INVENTED/.test(ds.meta.disclaimer));

  const dbStops = new Map((await all(
    `select code, latitude::float8 as lat, longitude::float8 as lon from public.stops`))
    .map((r) => [r.code, r]));
  check('every JSON stop matches the database coordinates',
    ds.stops.every((s) => {
      const d = dbStops.get(s.code);
      return d && Math.abs(d.lat - s.latitude) < 1e-6 && Math.abs(d.lon - s.longitude) < 1e-6;
    }));

  const validCoord = (lat, lon) =>
    Number.isFinite(lat) && Number.isFinite(lon)
    && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  check('every JSON stop coordinate is a valid latitude/longitude',
    ds.stops.every((s) => validCoord(s.latitude, s.longitude)));
  check('every JSON location fix is a valid latitude/longitude',
    ds.latest_locations.every((l) => validCoord(l.latitude, l.longitude)));
  check('every JSON heading is within 0-360',
    ds.latest_locations.every((l) => l.heading_deg === null
      || (l.heading_deg >= 0 && l.heading_deg < 360)));

  const stopCodes = new Set(ds.stops.map((s) => s.code));
  const routeCodes = new Set(ds.routes.map((r) => r.code));
  const busRegs = new Set(ds.buses.map((b) => b.registration_no));
  const licences = new Set(ds.drivers.map((d) => d.license_no));
  const emails = new Set(ds.profiles.map((p) => p.email));

  check('every JSON route_stop references a known route and stop',
    ds.route_stops.every((rs) => routeCodes.has(rs.route_code) && stopCodes.has(rs.stop_code)));
  check('every JSON trip references a known route, bus and driver',
    ds.trips.every((t) => routeCodes.has(t.route_code) && busRegs.has(t.bus_registration_no)
      && (t.driver_license_no === null || licences.has(t.driver_license_no))));
  check('every JSON trip next_stop_code resolves',
    ds.trips.every((t) => t.next_stop_code === null || stopCodes.has(t.next_stop_code)));
  check('every JSON bus driver assignment resolves',
    ds.buses.every((b) => b.assigned_driver_license_no === null
      || licences.has(b.assigned_driver_license_no)));
  check('every JSON driver profile link resolves',
    ds.drivers.every((d) => d.profile_email === null || emails.has(d.profile_email)));
  check('every JSON alert scope resolves',
    ds.service_alerts.every((a) =>
      (a.route_code === null || routeCodes.has(a.route_code))
      && (a.bus_registration_no === null || busRegs.has(a.bus_registration_no))
      && (a.stop_code === null || stopCodes.has(a.stop_code))));
  check('every JSON location references a known bus',
    ds.latest_locations.every((l) => busRegs.has(l.bus_registration_no)));

  const scenarioNames = ds.trips.map((t) => t.demo_scenario).filter(Boolean);
  check('all five GPS scenarios are represented by a trip',
    ['ON_TIME', 'DELAYED', 'STOPPED', 'GPS_UNAVAILABLE', 'COMPLETED']
      .every((s) => scenarioNames.includes(s)),
    scenarioNames.join(', '));
}

console.log('\nGPS scenarios (data/gps-scenarios.json)');
let gs = null;
try {
  gs = JSON.parse(await readFile(path.join(root, 'data', 'gps-scenarios.json'), 'utf8'));
} catch {
  check('data/gps-scenarios.json exists', false, 'run node scripts/export-demo-data.mjs');
}

if (gs) {
  check('five scenarios defined', gs.scenarios.length === 5,
    gs.scenarios.map((s) => s.name).join(', '));
  check('every scenario names a seeded demo trip',
    gs.scenarios.every((s) => ds?.trips.some((t) => t.trip_code === s.demo_trip_code)));
  check('scenario thresholds match the SQL views',
    gs.thresholds.gps_stale_seconds === 180
      && gs.thresholds.vehicle_not_reporting_seconds === 600
      && gs.thresholds.delayed_threshold_minutes === 5);
  check('route walk ladder has stops and interpolated points',
    gs.example_route_walk.stops.length === 10
      && gs.example_route_walk.interpolated_every_2km.length === 9);
  check('interpolated ladder coordinates are valid and inside Karachi',
    gs.example_route_walk.interpolated_every_2km.every((p) =>
      p.latitude >= 24.6 && p.latitude <= 25.2 && p.longitude >= 66.8 && p.longitude <= 67.4));
  check('interpolated ladder distance increases monotonically',
    gs.example_route_walk.interpolated_every_2km.every((p, i, a) => i === 0 || p.km > a[i - 1].km));
}

// ---------------------------------------------------------------------------
// Trip lifecycle: drives the golden path through the SQL layer so the driver
// controls, the simulator and the derived states are exercised for real.
// ---------------------------------------------------------------------------
console.log('\nTrip lifecycle and simulation');

const scheduled = await one(`
  select t.id, t.trip_code, t.bus_id, r.distance_km
  from public.trips t
  join public.routes r on r.id = t.route_id
  where t.status = 'scheduled'
  order by t.scheduled_start_at
  limit 1`);

check('a scheduled trip exists to start', Boolean(scheduled?.id));

if (scheduled?.id) {
  const tripId = scheduled.id;

  async function liveRow(id) {
    return one(`select * from public.v_trip_live where trip_id = $1`, [id]);
  }

  check('scheduled trip reports SCHEDULED',
    (await liveRow(tripId)).operational_state === 'SCHEDULED');

  // Cannot advance a trip that has not started.
  let rejected = false;
  try {
    await db.query(`select public.fn_advance_trip($1, 5, 20)`, [tripId]);
  } catch {
    rejected = true;
  }
  check('cannot advance a trip that is not in progress', rejected);

  // Cannot end a trip that is not active.
  rejected = false;
  try {
    await db.query(`select public.fn_end_trip($1)`, [tripId]);
  } catch {
    rejected = true;
  }
  check('cannot end a trip that is not in progress', rejected);

  await db.query(`select public.fn_start_trip($1)`, [tripId]);
  const started = await liveRow(tripId);
  check('start_trip moves the trip to in_progress', started.status === 'in_progress');
  check('start_trip emits an opening GPS fix', started.latitude !== null);
  check('start_trip sets the bus active', started.bus_status === 'active');
  check('a just-started stationary bus reads STOPPED', started.operational_state === 'STOPPED');

  // A second concurrent trip on the same bus must be refused.
  const sameBus = await one(`
    select id from public.trips
    where bus_id = $1 and status = 'scheduled' and id <> $2 limit 1`,
    [scheduled.bus_id, tripId]);
  if (sameBus?.id) {
    rejected = false;
    try {
      await db.query(`select public.fn_start_trip($1)`, [sameBus.id]);
    } catch {
      rejected = true;
    }
    check('refuses a second concurrent trip for the same bus', rejected);
  }

  // Simulate movement: 12 ticks of 60s at 30 km/h = 6 km of progress.
  const before = await liveRow(tripId);
  for (let i = 0; i < 12; i += 1) {
    await db.query(`select public.fn_advance_trip($1, 60, 30)`, [tripId]);
  }
  const moved = await liveRow(tripId);

  check('simulation increases progress_km',
    Number(moved.progress_km) > Number(before.progress_km),
    `${before.progress_km} -> ${moved.progress_km}`);
  check('simulation moves the coordinates',
    moved.latitude !== before.latitude || moved.longitude !== before.longitude);
  check('simulated progress matches speed x time',
    Math.abs(Number(moved.progress_km) - 6) < 0.01, `got ${moved.progress_km}`);
  check('simulated position stays inside Karachi',
    Number(moved.latitude) >= 24.6 && Number(moved.latitude) <= 25.2
      && Number(moved.longitude) >= 66.8 && Number(moved.longitude) <= 67.4);
  check('moving bus with a fresh fix reads ON_TIME', moved.operational_state === 'ON_TIME');
  check('next stop advances with progress', moved.next_stop_id !== null);
  check('reported speed is the simulated speed', Number(moved.speed_kmh) === 30);

  const arrivals = await one(`
    select count(*)::int as n from public.trip_stop_times
    where trip_id = $1 and status = 'arrived'`, [tripId]);
  check('passed stops are stamped as arrived', arrivals.n > 0, `${arrivals.n} arrived`);

  // ETA must exist, be ordered by distance and respond to delay.
  const etas = await db.query(`
    select stop_order, eta_minutes, projected_delay_minutes
    from public.v_trip_stop_eta where trip_id = $1 order by stop_order`, [tripId]);
  check('ETA is produced for upcoming stops', etas.rows.length > 0);
  check('ETA increases with distance along the route',
    etas.rows.every((r, i, a) => i === 0 || Number(r.eta_minutes) >= Number(a[i - 1].eta_minutes)));

  await db.query(`select public.fn_set_trip_delay($1, 12)`, [tripId]);
  const delayed = await liveRow(tripId);
  check('delay is recorded on the trip', Number(delayed.delay_minutes) === 12);
  check('delayed trip reports DELAYED', delayed.operational_state === 'DELAYED');
  check('delayed trip is flagged is_delayed', delayed.is_delayed === true);

  const delayedEta = await db.query(`
    select projected_delay_minutes from public.v_trip_stop_eta
    where trip_id = $1 order by stop_order limit 1`, [tripId]);
  check('ETA projection reflects the delay',
    delayedEta.rows.length > 0 && Number(delayedEta.rows[0].projected_delay_minutes) !== 0);

  // Halted bus: an explicit zero speed must not be treated as "no value".
  await db.query(`select public.fn_advance_trip($1, 60, 0)`, [tripId]);
  const halted = await liveRow(tripId);
  check('zero speed is honoured rather than defaulted', Number(halted.speed_kmh) === 0);
  check('halted bus reports STOPPED', halted.operational_state === 'STOPPED');

  // Real-GPS path: snapped to the route, never regresses.
  const aheadStop = await one(`
    select s.latitude, s.longitude, rs.distance_from_start_km
    from public.route_stops rs
    join public.stops s on s.id = rs.stop_id
    join public.trips t on t.route_id = rs.route_id and t.direction = rs.direction
    where t.id = $1 and rs.distance_from_start_km > $2
    order by rs.stop_order limit 1`, [tripId, halted.progress_km]);

  if (aheadStop) {
    await db.query(`select public.fn_record_trip_location($1, $2, $3, 25, 90)`,
      [tripId, aheadStop.latitude, aheadStop.longitude]);
    const device = await liveRow(tripId);
    check('device GPS advances progress',
      Number(device.progress_km) > Number(halted.progress_km));
    check('device GPS is recorded as a device fix', device.location_source === 'device');

    // Feeding a backwards coordinate must not rewind progress.
    const origin = await one(`
      select s.latitude, s.longitude
      from public.route_stops rs
      join public.stops s on s.id = rs.stop_id
      join public.trips t on t.route_id = rs.route_id and t.direction = rs.direction
      where t.id = $1 order by rs.stop_order limit 1`, [tripId]);
    await db.query(`select public.fn_record_trip_location($1, $2, $3, 10, 90)`,
      [tripId, origin.latitude, origin.longitude]);
    const rewound = await liveRow(tripId);
    check('progress never goes backwards',
      Number(rewound.progress_km) >= Number(device.progress_km));
  }

  let badCoords = false;
  try {
    await db.query(`select public.fn_record_trip_location($1, 999, 999, 10, 0)`, [tripId]);
  } catch {
    badCoords = true;
  }
  check('invalid coordinates are rejected', badCoords);

  await db.query(`select public.fn_end_trip($1)`, [tripId]);
  const done = await liveRow(tripId);
  check('end_trip completes the trip', done.status === 'completed');
  check('completed trip reports COMPLETED', done.operational_state === 'COMPLETED');
  check('completed trip has no next stop', done.next_stop_id === null);
  check('completed trip records an end time', done.actual_end_at !== null);
  check('completed trip releases the bus', done.bus_status === 'idle');
  check('completed trip has no pending stop times',
    (await one(`select count(*)::int as n from public.trip_stop_times
                where trip_id = $1 and status = 'pending'`, [tripId])).n === 0);
  check('completed trip is excluded from v_active_trips',
    (await one(`select count(*)::int as n from public.v_active_trips where trip_id = $1`,
      [tripId])).n === 0);

  // Auto-completion when the simulator reaches the final stop.
  const another = await one(`
    select t.id, r.distance_km from public.trips t
    join public.routes r on r.id = t.route_id
    where t.status = 'scheduled' order by t.scheduled_start_at limit 1`);
  if (another?.id) {
    await db.query(`select public.fn_start_trip($1)`, [another.id]);
    await db.query(`select public.fn_advance_trip($1, 3600, $2)`,
      [another.id, Number(another.distance_km) * 2]);
    const autoDone = await liveRow(another.id);
    check('simulation auto-completes on reaching the final stop',
      autoDone.status === 'completed', autoDone.status);
    check('auto-completed progress equals route distance',
      Math.abs(Number(autoDone.progress_km) - Number(another.distance_km)) < 0.01);
  }
}

console.log('\nMap polyline');
const pathRoute = await one(`select id from public.routes where is_active limit 1`);
const polyline = await db.query(
  `select * from public.fn_route_path($1, 'outbound')`, [pathRoute.id]);
check('route path returns ordered stops', polyline.rows.length >= 2);
check('route path is ordered by stop_order',
  polyline.rows.every((r, i, a) => i === 0 || r.stop_order > a[i - 1].stop_order));
check('route path distances increase monotonically',
  polyline.rows.every((r, i, a) => i === 0
    || Number(r.distance_from_start_km) >= Number(a[i - 1].distance_from_start_km)));
check('route path coordinates are all valid',
  polyline.rows.every((r) => Number(r.latitude) >= -90 && Number(r.latitude) <= 90
    && Number(r.longitude) >= -180 && Number(r.longitude) <= 180));

console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length > 0) {
  console.log(`Failed: ${failures.join('; ')}`);
  process.exit(1);
}
await db.close();
