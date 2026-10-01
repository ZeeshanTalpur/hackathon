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
  'supabase/seed.sql',
];

const EXPECTED_COUNTS = {
  profiles: 10,
  drivers: 8,
  buses: 10,
  stops: 31,
  routes: 5,
  route_stops: 66,
  trips: 8,
  trip_stop_times: 66,
  bus_locations: 38,
  service_alerts: 5,
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
check('6 views', views.n === 6, `got ${views.n}`);

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

console.log('\nDashboard views');
const overview = await one(`select * from public.v_fleet_overview`);
check('fleet overview totals are consistent',
  overview.total_buses === 10 && overview.trips_in_progress === 4 && overview.active_alerts === 4,
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

console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length > 0) {
  console.log(`Failed: ${failures.join('; ')}`);
  process.exit(1);
}
await db.close();
