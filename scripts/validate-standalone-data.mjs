/**
 * Validates data/standalone/karachi-demo-data.json (DEMO / SIMULATED HACKATHON DATA).
 *
 * This is the standalone dataset documented in docs/standalone/. It is not the
 * seed-derived data/karachi-demo-data.json, which scripts/validate-db.mjs checks.
 *
 *   node scripts/validate-standalone-data.mjs [path/to/karachi-demo-data.json]
 *
 * No dependencies. Exits 1 if any check fails.
 *
 * Besides structural checks (IDs, references, coordinates, vocabularies), the
 * geometry, timetable and GPS-scenario rules from docs/standalone/gps-scenarios.md are
 * re-implemented here from scratch, so every trip snapshot, scenario snapshot
 * and checkpoint in the file is re-derived rather than trusted.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2] || path.join(root, 'data/standalone/karachi-demo-data.json');

let data;
try {
  data = JSON.parse(await readFile(file, 'utf8'));
} catch (error) {
  console.log(`  FAIL  ${file} is not readable JSON - ${error.message}`);
  process.exit(1);
}

const failures = [];
let checks = 0;
function check(name, problems) {
  checks += 1;
  const list = Array.isArray(problems) ? problems : problems ? [] : ['condition is false'];
  if (list.length === 0) {
    console.log(`  PASS  ${name}`);
  } else {
    console.log(`  FAIL  ${name}`);
    for (const p of list.slice(0, 8)) console.log(`          - ${p}`);
    if (list.length > 8) console.log(`          - ... ${list.length - 8} more`);
    failures.push(name);
  }
}
const near = (a, b, tol) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol;
const r1 = (x) => Math.round(x * 10) / 10;

// -----------------------------------------------------------------------------
console.log('Structure and labelling');
const SECTIONS = ['meta', 'stops', 'routes', 'route_stops', 'drivers', 'buses', 'trips', 'bus_positions_at_t0',
  'service_alerts', 'eta_inputs', 'gps_scenarios', 'demo_stories', 'trip_history'];
check('all top-level sections present', SECTIONS.filter((k) => !(k in data)).map((k) => `missing ${k}`));
const meta = data.meta || {};
check('dataset is labelled DEMO / SIMULATED HACKATHON DATA',
  meta.data_status === 'DEMO / SIMULATED HACKATHON DATA' && /NOT official/.test(meta.disclaimer || ''));
const segmentsArr = data.eta_inputs?.route_segments || [];
const actualCounts = {
  stops: data.stops.length, routes: data.routes.length, active_routes: data.routes.filter((r) => r.status === 'active').length,
  route_stops: data.route_stops.length, route_segments: segmentsArr.length, drivers: data.drivers.length,
  buses: data.buses.length, trips: data.trips.length, bus_positions_at_t0: data.bus_positions_at_t0.length,
  service_alerts: data.service_alerts.length, gps_scenarios: data.gps_scenarios.length,
  demo_stories: data.demo_stories.length, trip_history: data.trip_history.length,
};
check('meta.counts matches the arrays', Object.entries(actualCounts)
  .filter(([k, v]) => meta.counts?.[k] !== v).map(([k, v]) => `${k}: meta says ${meta.counts?.[k]}, file has ${v}`));

// -----------------------------------------------------------------------------
console.log('\nIdentifiers');
const ID_RULES = [
  ['stops', /^STOP-\d{2}$/], ['routes', /^ROUTE-\d{2}$/], ['drivers', /^DRV-\d{2}$/], ['buses', /^BUS-\d{2}$/],
  ['trips', /^TRIP-\d{2}$/], ['service_alerts', /^ALERT-\d{2}$/], ['gps_scenarios', /^GPS-[A-Z]$/],
  ['demo_stories', /^DEMO-\d+$/], ['trip_history', /^HIST-\d{2}$/],
];
const idProblems = [];
const ALL_IDS = new Set();
for (const [section, pattern] of ID_RULES) {
  const seen = new Set();
  for (const row of data[section]) {
    if (!pattern.test(row.id)) idProblems.push(`${section}: bad id ${row.id}`);
    if (seen.has(row.id)) idProblems.push(`${section}: duplicate id ${row.id}`);
    seen.add(row.id);
    ALL_IDS.add(row.id);
  }
}
check('ids are unique and well-formed in every section', idProblems);
const dupes = (rows, key) => {
  const seen = new Set();
  return rows.filter((r) => r[key] !== null && (seen.has(r[key]) || !seen.add(r[key]))).map((r) => `duplicate ${key} ${r[key]}`);
};
check('natural keys are unique (bus number, registration, licence, route short name, stop name)', [
  ...dupes(data.buses, 'bus_number'), ...dupes(data.buses, 'registration_no'), ...dupes(data.drivers, 'license_no'),
  ...dupes(data.routes, 'short_name'), ...dupes(data.stops, 'name')]);
check('registrations and licence numbers are visibly fake (DEMO- prefix)', [
  ...data.buses.filter((b) => !b.registration_no.startsWith('DEMO-')).map((b) => b.id),
  ...data.drivers.filter((d) => !d.license_no.startsWith('DEMO-')).map((d) => d.id)]);

const byId = (rows) => new Map(rows.map((r) => [r.id, r]));
const STOPS = byId(data.stops);
const ROUTES = byId(data.routes);
const DRIVERS = byId(data.drivers);
const BUSES = byId(data.buses);
const TRIPS = byId(data.trips);
const SCENARIOS = byId(data.gps_scenarios);

// -----------------------------------------------------------------------------
console.log('\nCoordinates');
// Generous Karachi bounding box; also catches swapped lat/lon (Karachi is ~24.9 N, ~67.0 E).
const BOX = { latMin: 24.75, latMax: 25.1, lonMin: 66.9, lonMax: 67.25 };
function coordProblem(where, lat, lon) {
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) return `${where}: non-numeric coordinate (${lat}, ${lon})`;
  if (lat < BOX.latMin || lat > BOX.latMax || lon < BOX.lonMin || lon > BOX.lonMax) return `${where}: (${lat}, ${lon}) is outside the Karachi box`;
  return null;
}
const coordProblems = [];
const addCoord = (where, obj) => {
  const p = coordProblem(where, obj?.latitude, obj?.longitude);
  if (p) coordProblems.push(p);
};
data.stops.forEach((s) => addCoord(s.id, s));
data.bus_positions_at_t0.forEach((p) => addCoord(`position ${p.bus_id}`, p));
data.trips.filter((t) => t.live).forEach((t) => addCoord(`${t.id}.live`, t.live));
for (const sc of data.gps_scenarios) {
  addCoord(`${sc.id}.snapshot`, sc.snapshot);
  sc.checkpoints.forEach((c) => {
    addCoord(`${sc.id}@${c.t_s}`, c);
    if (c.displayed_position) addCoord(`${sc.id}@${c.t_s}.displayed`, c.displayed_position);
  });
}
for (const ds of data.demo_stories) {
  (ds.checkpoints || []).forEach((c) => addCoord(`${ds.id}@${c.t_s}`, c));
  for (const k of ['last_fix', 'on_restore', 'position_after_hold']) if (ds.expected?.[k]) addCoord(`${ds.id}.${k}`, ds.expected[k]);
}
check(`every coordinate is numeric and inside the Karachi bounding box`, coordProblems);

const R_KM = 6371.0088;
const rad = (d) => (d * Math.PI) / 180;
function haversineKm(a, b) {
  const h = Math.sin(rad(b.latitude - a.latitude) / 2) ** 2
    + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.sqrt(h));
}
const closePairs = [];
for (let i = 0; i < data.stops.length; i += 1) {
  for (let j = i + 1; j < data.stops.length; j += 1) {
    const d = haversineKm(data.stops[i], data.stops[j]);
    if (d < 0.15) closePairs.push(`${data.stops[i].id} and ${data.stops[j].id} are only ${Math.round(d * 1000)} m apart`);
  }
}
check('no two stops sit on top of each other (>= 150 m apart)', closePairs);

// -----------------------------------------------------------------------------
console.log('\nVocabularies');
const V = meta.vocabularies || {};
const vocabProblems = [];
const inVocab = (where, vocab, value, nullable = false) => {
  if (value === null && nullable) return;
  if (!V[vocab]?.includes(value)) vocabProblems.push(`${where}: "${value}" is not in ${vocab}`);
};
data.routes.forEach((r) => inVocab(r.id, 'route_status', r.status));
data.buses.forEach((b) => inVocab(b.id, 'bus_status', b.status));
data.drivers.forEach((d) => inVocab(d.id, 'driver_status', d.status));
data.trips.forEach((t) => { inVocab(t.id, 'trip_status', t.status); inVocab(t.id, 'direction', t.direction); inVocab(t.id, 'gps_source', t.gps_source); });
data.trip_history.forEach((h) => { inVocab(h.id, 'trip_status', h.status); inVocab(h.id, 'direction', h.direction); });
data.route_stops.forEach((rs) => inVocab(`${rs.route_id}/${rs.sequence}`, 'direction', rs.direction));
data.bus_positions_at_t0.forEach((p) => inVocab(`position ${p.bus_id}`, 'gps_source', p.source));
data.service_alerts.forEach((a) => { inVocab(a.id, 'alert_status', a.status); inVocab(a.id, 'alert_severity', a.severity); inVocab(a.id, 'alert_audience', a.audience); });
const stateFields = [['tracking_state', 'tracking_state'], ['motion_state', 'motion_state'], ['punctuality', 'punctuality']];
for (const sc of data.gps_scenarios) {
  for (const c of sc.checkpoints) for (const [f, v] of stateFields) if (f in c) inVocab(`${sc.id}@${c.t_s}`, v, c[f]);
}
check('every status / state value comes from meta.vocabularies', vocabProblems);

// -----------------------------------------------------------------------------
console.log('\nReferences');
const refProblems = [];
const ref = (where, map, id, nullable = false) => {
  if (id === null && nullable) return;
  if (!map.has(id)) refProblems.push(`${where} -> missing ${id}`);
};
for (const r of data.routes) {
  r.stop_ids.forEach((s) => ref(`${r.id}.stop_ids`, STOPS, s));
  if (r.origin_stop_id !== r.stop_ids[0] || r.destination_stop_id !== r.stop_ids.at(-1)) refProblems.push(`${r.id}: origin/destination ids do not match stop_ids`);
  if (STOPS.get(r.origin_stop_id)?.name !== r.origin || STOPS.get(r.destination_stop_id)?.name !== r.destination) refProblems.push(`${r.id}: origin/destination names do not match the stops`);
  if (new Set(r.stop_ids).size !== r.stop_ids.length) refProblems.push(`${r.id}: visits a stop twice`);
}
data.route_stops.forEach((rs) => { ref(`route_stops ${rs.route_id}`, ROUTES, rs.route_id); ref(`route_stops ${rs.route_id}/${rs.sequence}`, STOPS, rs.stop_id); });
segmentsArr.forEach((sg) => { ref('segment', ROUTES, sg.route_id); ref('segment', STOPS, sg.from_stop_id); ref('segment', STOPS, sg.to_stop_id); });
data.buses.forEach((b) => { ref(b.id, ROUTES, b.assigned_route_id, true); ref(b.id, DRIVERS, b.assigned_driver_id, true); });
data.trips.forEach((t) => { ref(t.id, ROUTES, t.route_id); ref(t.id, BUSES, t.bus_id); ref(t.id, DRIVERS, t.driver_id, true); ref(t.id, SCENARIOS, t.scenario_id, true); });
data.bus_positions_at_t0.forEach((p) => { ref('position', BUSES, p.bus_id); ref(`position ${p.bus_id}`, TRIPS, p.trip_id, true); });
data.service_alerts.forEach((a) => { ref(a.id, ROUTES, a.route_id, true); ref(a.id, STOPS, a.stop_id, true); ref(a.id, BUSES, a.bus_id, true); });
data.trip_history.forEach((h) => { ref(h.id, ROUTES, h.route_id); ref(h.id, BUSES, h.bus_id); ref(h.id, DRIVERS, h.driver_id, true); });
data.gps_scenarios.forEach((sc) => { ref(sc.id, BUSES, sc.bus_id); ref(sc.id, TRIPS, sc.trip_id); ref(sc.id, ROUTES, sc.route_id); });
// any *_id / *_ids value anywhere in scenarios and demo stories must point at a real entity
function walkIds(where, node) {
  if (Array.isArray(node)) { node.forEach((x) => walkIds(where, x)); return; }
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    const values = k.endsWith('_ids') ? v : k.endsWith('_id') ? [v] : null;
    if (values) for (const id of values) if (id !== null && !ALL_IDS.has(id)) refProblems.push(`${where}.${k} -> unknown id ${id}`);
    if (v && typeof v === 'object') walkIds(where, v);
  }
}
data.gps_scenarios.forEach((sc) => walkIds(sc.id, sc));
data.demo_stories.forEach((ds) => walkIds(ds.id, ds));
check('every route / stop / bus / driver / trip reference resolves', refProblems);

const assigned = data.buses.map((b) => b.assigned_driver_id).filter(Boolean);
check('no driver is assigned to more than one bus', assigned.filter((d, i) => assigned.indexOf(d) !== i));
const usedStops = new Set(data.routes.flatMap((r) => r.stop_ids));
check('every stop is served by at least one route', data.stops.filter((s) => !usedStops.has(s.id)).map((s) => s.id));
check('every active route has at least one bus assigned', data.routes.filter((r) => r.status === 'active'
  && !data.buses.some((b) => b.assigned_route_id === r.id)).map((r) => r.id));

// -----------------------------------------------------------------------------
console.log('\nRoute geometry and timetable');
const LINES = new Map();
const lineProblems = [];
for (const r of data.routes) {
  for (const direction of ['outbound', 'inbound']) {
    const rows = data.route_stops.filter((rs) => rs.route_id === r.id && rs.direction === direction).sort((a, b) => a.sequence - b.sequence);
    const expected = direction === 'outbound' ? r.stop_ids : [...r.stop_ids].reverse();
    const where = `${r.id} ${direction}`;
    if (rows.map((x) => x.stop_id).join() !== expected.join()) { lineProblems.push(`${where}: stop order does not match routes[].stop_ids`); continue; }
    rows.forEach((x, i) => {
      if (x.sequence !== i + 1) lineProblems.push(`${where}: sequence gap at ${x.sequence}`);
      if (x.is_terminal !== (i === 0 || i === rows.length - 1)) lineProblems.push(`${where}: is_terminal wrong at ${x.sequence}`);
      if (!Number.isInteger(x.scheduled_offset_min)) lineProblems.push(`${where}: non-integer offset at ${x.sequence}`);
      if (i > 0 && !(x.distance_from_start_km > rows[i - 1].distance_from_start_km)) lineProblems.push(`${where}: distance not increasing at ${x.sequence}`);
      if (i > 0 && !(x.scheduled_offset_min > rows[i - 1].scheduled_offset_min)) lineProblems.push(`${where}: offset not increasing at ${x.sequence}`);
    });
    if (rows[0].distance_from_start_km !== 0 || rows[0].scheduled_offset_min !== 0) lineProblems.push(`${where}: first stop is not at 0 km / 0 min`);
    if (!near(rows.at(-1).distance_from_start_km, r.distance_km, 1e-9)) lineProblems.push(`${where}: last stop km != route distance_km`);
    if (rows.at(-1).scheduled_offset_min !== r.scheduled_duration_min) lineProblems.push(`${where}: last offset != scheduled_duration_min`);
    LINES.set(`${r.id}|${direction}`, {
      D: r.distance_km,
      dur: r.scheduled_duration_min,
      ids: rows.map((x) => x.stop_id),
      km: rows.map((x) => x.distance_from_start_km),
      off: rows.map((x) => x.scheduled_offset_min),
      lat: rows.map((x) => STOPS.get(x.stop_id).latitude),
      lon: rows.map((x) => STOPS.get(x.stop_id).longitude),
    });
  }
  const out = LINES.get(`${r.id}|outbound`);
  const inn = LINES.get(`${r.id}|inbound`);
  if (out && inn) {
    out.ids.forEach((id, i) => {
      const j = inn.ids.indexOf(id);
      if (!near(inn.km[j], r.distance_km - out.km[i], 0.001) || inn.off[j] !== r.scheduled_duration_min - out.off[i]) lineProblems.push(`${r.id}: inbound does not mirror outbound at ${id}`);
    });
  }
  if (!near(r.planning_speed_kmh, (r.distance_km / r.scheduled_duration_min) * 60, 0.051)) lineProblems.push(`${r.id}: planning_speed_kmh != distance / duration`);
}
check('route_stops: gapless sequences, same order as routes[].stop_ids, increasing km and minutes', lineProblems);

const roadProblems = [];
for (const [key, L] of LINES) {
  if (!key.endsWith('outbound')) continue;
  for (let i = 0; i < L.ids.length - 1; i += 1) {
    const crow = haversineKm(STOPS.get(L.ids[i]), STOPS.get(L.ids[i + 1]));
    const road = L.km[i + 1] - L.km[i];
    const kmh = (road / (L.off[i + 1] - L.off[i])) * 60;
    if (road < crow - 0.05 || road > crow * 1.6 + 0.1) roadProblems.push(`${key} ${L.ids[i]}->${L.ids[i + 1]}: road ${road.toFixed(1)} km vs straight line ${crow.toFixed(2)} km`);
    if (kmh < 8 || kmh > 40) roadProblems.push(`${key} ${L.ids[i]}->${L.ids[i + 1]}: implausible timetable speed ${kmh.toFixed(1)} km/h`);
  }
}
check('segment road distances are 1.0-1.6x the straight line and timetable speeds are 8-40 km/h', roadProblems);

const segProblems = [];
for (const [key, L] of LINES) {
  const [routeId, direction] = key.split('|');
  const segs = segmentsArr.filter((s) => s.route_id === routeId && s.direction === direction).sort((a, b) => a.sequence - b.sequence);
  if (segs.length !== L.ids.length - 1) { segProblems.push(`${key}: ${segs.length} segments for ${L.ids.length} stops`); continue; }
  segs.forEach((s, i) => {
    if (s.sequence !== i + 1 || s.from_stop_id !== L.ids[i] || s.to_stop_id !== L.ids[i + 1]) segProblems.push(`${key} segment ${s.sequence}: wrong stops`);
    if (!near(s.distance_km, L.km[i + 1] - L.km[i], 0.051)) segProblems.push(`${key} segment ${s.sequence}: distance disagrees with route_stops`);
    if (s.scheduled_run_min !== L.off[i + 1] - L.off[i]) segProblems.push(`${key} segment ${s.sequence}: scheduled_run_min disagrees with route_stops`);
    const h = s.historical_run_min || {};
    if (!(h.offpeak > 0 && h.peak >= h.offpeak)) segProblems.push(`${key} segment ${s.sequence}: historical times must be > 0 with peak >= offpeak`);
  });
}
check('eta_inputs.route_segments agree with route_stops (one per stop pair, both directions)', segProblems);

// -----------------------------------------------------------------------------
// Independent re-implementation of the position / timetable / simulation rules.
function segIndex(L, km) {
  let i = 0;
  for (let k = 0; k < L.km.length; k += 1) if (L.km[k] <= km + 1e-9) i = k;
  return i;
}
function where(L, kmIn) {
  const km = Math.min(Math.max(kmIn, 0), L.D);
  const i = segIndex(L, km);
  if (i === L.km.length - 1) return { km, i, lat: L.lat[i], lon: L.lon[i], last: L.ids[i], next: null, toNext: 0, sched: L.off[i] };
  const f = (km - L.km[i]) / (L.km[i + 1] - L.km[i]);
  return {
    km, i, f,
    lat: L.lat[i] + (L.lat[i + 1] - L.lat[i]) * f,
    lon: L.lon[i] + (L.lon[i + 1] - L.lon[i]) * f,
    last: L.ids[i], next: L.ids[i + 1], toNext: L.km[i + 1] - km,
    sched: L.off[i] + (L.off[i + 1] - L.off[i]) * f,
  };
}
function kmAtSched(L, oIn) {
  const o = Math.min(Math.max(oIn, 0), L.dur);
  for (let i = 0; i < L.off.length - 1; i += 1) {
    if (o <= L.off[i + 1]) return L.km[i] + ((L.km[i + 1] - L.km[i]) * (o - L.off[i])) / (L.off[i + 1] - L.off[i]);
  }
  return L.D;
}
function pace(L, km) {
  if (km >= L.D - 1e-9) return 0;
  const i = segIndex(L, km);
  return ((L.km[i + 1] - L.km[i]) / (L.off[i + 1] - L.off[i])) * 60;
}
const TH = meta.thresholds;
function motion(L, km, speed) {
  if (speed <= TH.stopped_if_speed_kmh_at_most) {
    return L.km.some((k) => Math.abs(k - km) <= TH.at_stop_within_km + 1e-9) ? 'at_stop' : 'stopped';
  }
  const w = where(L, km);
  return w.next && w.toNext <= TH.approaching_within_km + 1e-9 ? 'approaching' : 'moving';
}
const punctual = (delay) => {
  const d = r1(delay);
  if (d >= TH.delayed_if_delay_min_at_least) return 'delayed';
  return d < TH.early_if_delay_min_below ? 'early' : 'on_time';
};
const tracking = (age) => (age <= TH.live_if_fix_age_s_at_most ? 'live' : age <= TH.unavailable_if_fix_age_s_over ? 'stale' : 'unavailable');

/** Builds a function t -> {km, speed} from a phase list (phases run back to back; a boundary belongs to the next phase). */
function runner(L, startS, startKm, schedStartS, phases, problems, label) {
  const pieces = [];
  let t = startS;
  let km = startKm;
  for (const ph of phases) {
    const t0 = t;
    const km0 = km;
    if (!(ph.until_s >= t0)) problems.push(`${label}: phase ${ph.type} ends before it starts`);
    if (ph.type === 'follow_schedule') {
      const d0 = (t0 - schedStartS) / 60 - where(L, km0).sched;
      const at = (x) => Math.max(km0, kmAtSched(L, (x - schedStartS) / 60 - d0));
      pieces.push({ t0, t1: ph.until_s, state: (x) => { const k = at(x); return { km: k, speed: pace(L, k) }; } });
      km = at(ph.until_s);
    } else if (ph.type === 'drive') {
      const at = (x) => Math.min(km0 + (ph.speed_kmh * (x - t0)) / 3600, L.D);
      pieces.push({ t0, t1: ph.until_s, state: (x) => ({ km: at(x), speed: ph.speed_kmh }) });
      km = at(ph.until_s);
      if (ph.until_km !== undefined && !near(km, ph.until_km, 0.001)) problems.push(`${label}: drive phase reaches ${km.toFixed(3)} km, not until_km ${ph.until_km}`);
      if (ph.duration_s !== undefined && !near(ph.until_s - t0, ph.duration_s, 0.001)) problems.push(`${label}: drive duration_s disagrees with until_s`);
    } else if (ph.type === 'dwell') {
      pieces.push({ t0, t1: ph.until_s, state: () => ({ km: km0, speed: 0 }) });
      const stopKm = L.km[L.ids.indexOf(ph.at_stop_id)];
      if (!near(km0, stopKm, 0.001)) problems.push(`${label}: dwell at ${ph.at_stop_id} starts ${km0.toFixed(3)} km, stop is at ${stopKm} km`);
      if (ph.duration_s !== undefined && !near(ph.until_s - t0, ph.duration_s, 0.001)) problems.push(`${label}: dwell duration_s disagrees with until_s`);
    } else {
      problems.push(`${label}: unknown phase type ${ph.type}`);
    }
    t = ph.until_s;
  }
  return (x) => {
    const piece = pieces.find((p) => x >= p.t0 && x < p.t1) || pieces.at(-1);
    const s = piece.state(x);
    const w = where(L, s.km);
    const delay = (x - schedStartS) / 60 - w.sched;
    return { ...s, w, delay, motion: motion(L, s.km, s.speed), punctuality: punctual(delay) };
  };
}
function lastFix(gps, startS, t) {
  let tick = startS + Math.floor((t - startS) / gps.tick_s) * gps.tick_s;
  for (const o of gps.outages || []) {
    if (tick > o.last_fix_s && (o.restored_s === null || tick < o.restored_s)) tick = o.last_fix_s;
  }
  return tick;
}
function compareState(label, got, sim, problems, opts = {}) {
  const exp = {
    progress_km: sim.km, latitude: sim.w.lat, longitude: sim.w.lon, speed_kmh: sim.speed, delay_min: sim.delay,
    starting_stop_id: sim.w.last, next_stop_id: sim.w.next, motion_state: sim.motion, punctuality: sim.punctuality,
  };
  const tol = { progress_km: 0.0015, latitude: 0.00002, longitude: 0.00002, speed_kmh: 0.051, delay_min: 0.051 };
  for (const [k, v] of Object.entries(exp)) {
    if (!(k in got) || (opts.skip || []).includes(k)) continue;
    const ok = k in tol ? near(got[k], v, tol[k]) : got[k] === v;
    if (!ok) problems.push(`${label}: ${k} is ${JSON.stringify(got[k])}, re-derived ${typeof v === 'number' ? v.toFixed(5) : v}`);
  }
}

// -----------------------------------------------------------------------------
console.log('\nTrips, buses and drivers');
const tripProblems = [];
for (const t of data.trips) {
  const L = LINES.get(`${t.route_id}|${t.direction}`);
  const bus = BUSES.get(t.bus_id);
  if (t.scheduled_end_offset_min !== t.scheduled_start_offset_min + L.dur) tripProblems.push(`${t.id}: scheduled_end != start + route duration`);
  if (t.status === 'in_progress') {
    if (bus.status !== 'active') tripProblems.push(`${t.id}: bus ${bus.id} should be active, is ${bus.status}`);
    if (bus.assigned_driver_id !== t.driver_id) tripProblems.push(`${t.id}: driver differs from the bus assignment`);
    if (DRIVERS.get(t.driver_id)?.status !== 'active') tripProblems.push(`${t.id}: driver is not on duty`);
    if (t.actual_start_offset_min === null || t.actual_start_offset_min > 0) tripProblems.push(`${t.id}: in_progress trip needs a past actual start`);
    if (!t.live) { tripProblems.push(`${t.id}: in_progress trip has no live snapshot`); continue; }
    const v = t.live;
    const w = where(L, v.progress_km);
    const elapsed = v.as_of_offset_s / 60 - t.scheduled_start_offset_min;
    const delay = elapsed - w.sched;
    const want = {
      route_distance_km: [L.D, 1e-9], scheduled_duration_min: [L.dur, 0], remaining_km: [L.D - v.progress_km, 0.0015],
      progress_pct: [(100 * v.progress_km) / L.D, 0.051], current_segment_sequence: [w.i + 1, 0], segment_fraction: [w.f, 0.0015],
      distance_to_next_stop_km: [w.toNext, 0.0015], elapsed_since_scheduled_start_min: [elapsed, 0.051],
      elapsed_since_actual_start_min: [v.as_of_offset_s / 60 - t.actual_start_offset_min, 0.051],
      scheduled_offset_at_position_min: [w.sched, 0.051], delay_min: [delay, 0.051], latitude: [w.lat, 0.00002], longitude: [w.lon, 0.00002],
    };
    for (const [k, [x, tol]] of Object.entries(want)) if (!near(v[k], x, tol)) tripProblems.push(`${t.id}.live.${k} is ${v[k]}, re-derived ${x}`);
    if (v.starting_stop_id !== w.last || v.next_stop_id !== w.next) tripProblems.push(`${t.id}.live: starting/next stop disagree with progress`);
    if (v.punctuality !== punctual(delay)) tripProblems.push(`${t.id}.live.punctuality should be ${punctual(delay)}`);
    if (v.motion_state !== motion(L, v.progress_km, v.current_speed_kmh)) tripProblems.push(`${t.id}.live.motion_state should be ${motion(L, v.progress_km, v.current_speed_kmh)}`);
    if (v.tracking_state !== tracking(v.last_fix_age_s)) tripProblems.push(`${t.id}.live.tracking_state should be ${tracking(v.last_fix_age_s)}`);
  } else if (t.status === 'scheduled') {
    if (t.live !== null || t.actual_start_offset_min !== null) tripProblems.push(`${t.id}: scheduled trip must have no live snapshot / actual start`);
    if (!(t.scheduled_start_offset_min > 0)) tripProblems.push(`${t.id}: scheduled trip should start after T0`);
    if (bus.status !== 'idle') tripProblems.push(`${t.id}: bus for a scheduled trip should be idle`);
  }
}
const liveBuses = data.trips.filter((t) => t.status === 'in_progress').map((t) => t.bus_id);
if (new Set(liveBuses).size !== liveBuses.length) tripProblems.push('a bus runs two trips at once');
for (const b of data.buses.filter((x) => x.status === 'active')) if (!liveBuses.includes(b.id)) tripProblems.push(`${b.id} is active but has no in_progress trip`);
check('trip snapshots are internally consistent (progress, position, delay, states, bus/driver status)', tripProblems);

const posProblems = [];
const POS = new Map(data.bus_positions_at_t0.map((p) => [p.bus_id, p]));
if (POS.size !== data.bus_positions_at_t0.length) posProblems.push('more than one T0 position for a bus');
for (const p of data.bus_positions_at_t0) {
  if (!(p.recorded_offset_s <= 0)) posProblems.push(`${p.bus_id}: position recorded after T0`);
  const t = p.trip_id && TRIPS.get(p.trip_id);
  if (t) {
    if (t.bus_id !== p.bus_id) posProblems.push(`${p.bus_id}: position trip belongs to another bus`);
    if (!near(p.latitude, t.live.latitude, 1e-9) || !near(p.longitude, t.live.longitude, 1e-9) || !near(p.progress_km, t.live.progress_km, 1e-9)) posProblems.push(`${p.bus_id}: position differs from ${t.id}.live`);
  }
}
for (const t of data.trips.filter((x) => x.status === 'in_progress')) if (!POS.has(t.bus_id)) posProblems.push(`${t.bus_id} is on a live trip but has no position`);
for (const b of data.buses.filter((x) => x.status === 'offline')) {
  const p = POS.get(b.id);
  if (p && -p.recorded_offset_s <= TH.unavailable_if_fix_age_s_over) posProblems.push(`${b.id} is offline but its last fix is fresh`);
}
check('T0 positions match live trips; offline buses have stale fixes', posProblems);

// -----------------------------------------------------------------------------
console.log('\nGPS scenarios (re-simulated)');
const scenarioProblems = [];
const SIMS = new Map();
for (const sc of data.gps_scenarios) {
  const trip = TRIPS.get(sc.trip_id);
  const L = LINES.get(`${sc.route_id}|${sc.direction}`);
  if (trip.route_id !== sc.route_id || trip.bus_id !== sc.bus_id || trip.direction !== sc.direction) scenarioProblems.push(`${sc.id}: does not match ${trip.id}`);
  const sim = runner(L, sc.starts_at_s, sc.initial_progress_km, trip.scheduled_start_offset_min * 60, sc.motion, scenarioProblems, sc.id);
  SIMS.set(sc.id, { sim, L, sc });
  const outages = sc.gps.outages || [];
  for (const c of sc.checkpoints) {
    const s = sim(c.t_s);
    compareState(`${sc.id}@${c.t_s}`, c, s, scenarioProblems);
    if (outages.length) {
      const fix = lastFix(sc.gps, sc.starts_at_s, c.t_s);
      const age = c.t_s - fix;
      if (c.last_fix_age_s !== age || c.tracking_state !== tracking(age) || c.fix_available !== (fix === c.t_s)) scenarioProblems.push(`${sc.id}@${c.t_s}: fix age / tracking / fix_available should be ${age} / ${tracking(age)} / ${fix === c.t_s}`);
      if (c.displayed_position) {
        const f = sim(fix);
        if (c.displayed_position.as_of_s !== fix || !near(c.displayed_position.latitude, f.w.lat, 0.00002) || !near(c.displayed_position.longitude, f.w.lon, 0.00002)) scenarioProblems.push(`${sc.id}@${c.t_s}: displayed_position is not the last fix`);
      } else if (fix !== c.t_s) {
        scenarioProblems.push(`${sc.id}@${c.t_s}: no fix at this time but no displayed_position given`);
      }
    }
  }
  const snap = sc.snapshot;
  if (outages.length) {
    const fixT = lastFix(sc.gps, sc.starts_at_s, snap.at_s);
    const f = sim(fixT);
    if (!near(snap.latitude, f.w.lat, 0.00002) || !near(snap.longitude, f.w.lon, 0.00002) || !near(snap.progress_km, f.km, 0.0015)) scenarioProblems.push(`${sc.id}.snapshot must show the last fix position`);
    if (snap.speed_kmh !== null || snap.delay_min !== null) scenarioProblems.push(`${sc.id}.snapshot: speed/delay must be null (unknown) while GPS is unavailable`);
    if (snap.last_fix_age_s !== snap.at_s - fixT || snap.expected_state.tracking_state !== tracking(snap.at_s - fixT)) scenarioProblems.push(`${sc.id}.snapshot: tracking state / age wrong`);
  } else {
    const s = sim(snap.at_s);
    compareState(`${sc.id}.snapshot`, snap, s, scenarioProblems);
    for (const k of ['motion_state', 'punctuality']) if (snap.expected_state[k] !== { motion_state: s.motion, punctuality: s.punctuality }[k]) scenarioProblems.push(`${sc.id}.snapshot.expected_state.${k} should be ${{ motion_state: s.motion, punctuality: s.punctuality }[k]}`);
  }
  if (sc.starts_at_s === 0 && trip.live) {
    if (!near(trip.live.latitude, sim(0).w.lat, 0.00002) || !near(trip.live.delay_min, sim(0).delay, 0.051) || !near(trip.live.current_speed_kmh, sim(0).speed, 0.051)) scenarioProblems.push(`${sc.id}: t=0 state differs from ${trip.id}.live`);
  }
}
check('every checkpoint and snapshot re-derives from its motion phases', scenarioProblems);

const want = { 'GPS-A': ['live', 'moving', 'on_time'], 'GPS-B': ['live', null, 'delayed'], 'GPS-C': ['live', 'approaching', null], 'GPS-D': ['live', 'stopped', 'on_time'], 'GPS-E': ['unavailable', null, null] };
check('scenarios A-E cover on-time, delayed, approaching, stopped-but-live and GPS-unavailable', Object.entries(want).flatMap(([id, [tr, mo, pu]]) => {
  const e = SCENARIOS.get(id)?.snapshot?.expected_state;
  if (!e) return [`${id} missing`];
  return [[tr, e.tracking_state], [mo, e.motion_state], [pu, e.punctuality]].filter(([w, g]) => w !== null && w !== g).map(([w, g]) => `${id}: expected ${w}, snapshot says ${g}`);
}));
check('the stopped bus (GPS-D) never shows as delayed or offline while stopped', (() => {
  const { sim, sc } = SIMS.get('GPS-D');
  const out = [];
  for (let t = sc.stopped_from_s; t < sc.stopped_until_s; t += 1) {
    const s = sim(t);
    if (s.motion !== 'stopped' || s.punctuality === 'delayed') out.push(`t=${t}: ${s.motion} / ${s.punctuality}`);
  }
  return out;
})());

// -----------------------------------------------------------------------------
console.log('\nDemo stories');
const DEMO = byId(data.demo_stories);
const demoProblems = [];
const norm = (x) => x.trim().toLowerCase();
const matchStops = (text) => data.stops.filter((s) => s.aliases.some((a) => norm(a) === norm(text))).map((s) => s.id);
{
  const d1 = DEMO.get('DEMO-1');
  const e = d1.expected;
  const from = matchStops(d1.trigger.from_text);
  const to = matchStops(d1.trigger.to_text);
  if (from.join() !== e.origin_stop_id) demoProblems.push(`DEMO-1: "${d1.trigger.from_text}" resolves to [${from}], expected ${e.origin_stop_id}`);
  if (to.join() !== e.destination_candidates.join()) demoProblems.push(`DEMO-1: "${d1.trigger.to_text}" resolves to [${to}]`);
  const options = [];
  for (const r of data.routes.filter((x) => x.status === 'active')) {
    for (const dir of ['outbound', 'inbound']) {
      const L = LINES.get(`${r.id}|${dir}`);
      const i = L.ids.indexOf(e.origin_stop_id);
      const j = L.ids.indexOf(e.destination_stop_id);
      if (i >= 0 && j > i) options.push({ route_id: r.id, direction: dir, from_sequence: i + 1, to_sequence: j + 1, distance_km: Math.round((L.km[j] - L.km[i]) * 10) / 10, scheduled_ride_min: L.off[j] - L.off[i] });
    }
  }
  if (JSON.stringify(options) !== JSON.stringify(e.route_options)) demoProblems.push(`DEMO-1: route options re-derive as ${JSON.stringify(options)}`);
  for (const lb of e.live_buses) {
    const t = TRIPS.get(lb.trip_id);
    const L = LINES.get(`${t.route_id}|${t.direction}`);
    const k = L.km[L.ids.indexOf(e.origin_stop_id)];
    if (!near(lb.distance_to_origin_stop_km, k - t.live.progress_km, 0.0015) || lb.scheduled_arrival_at_origin_offset_min !== t.scheduled_start_offset_min + L.off[L.ids.indexOf(e.origin_stop_id)] || !near(lb.delay_min, t.live.delay_min, 1e-9)) demoProblems.push(`DEMO-1: live bus ${lb.bus_id} figures do not re-derive`);
  }
  for (const st of e.scheduled_trips) {
    const t = TRIPS.get(st.trip_id);
    const L = LINES.get(`${t.route_id}|${t.direction}`);
    if (t.status !== 'scheduled' || st.departs_offset_min !== t.scheduled_start_offset_min || st.scheduled_arrival_at_origin_offset_min !== t.scheduled_start_offset_min + L.off[L.ids.indexOf(e.origin_stop_id)]) demoProblems.push(`DEMO-1: scheduled trip ${st.trip_id} figures do not re-derive`);
  }
}
{
  const d2 = DEMO.get('DEMO-2');
  const base = SCENARIOS.get('GPS-A');
  const trip = TRIPS.get(d2.trigger.trip_id);
  const L = LINES.get(`${trip.route_id}|${trip.direction}`);
  const phases = [{ type: 'follow_schedule', until_s: d2.trigger.at_s }, ...d2.trigger.motion_override];
  const sim = runner(L, 0, base.initial_progress_km, trip.scheduled_start_offset_min * 60, phases, demoProblems, 'DEMO-2');
  d2.checkpoints.forEach((c) => compareState(`DEMO-2@${c.t_s}`, c, sim(c.t_s), demoProblems));
  let first = null;
  for (let t = 0; t <= 1800 && first === null; t += 1) if (sim(t).punctuality === 'delayed') first = t;
  const holdEnd = d2.trigger.motion_override[0].until_s;
  if (first !== d2.expected.delayed_from_s) demoProblems.push(`DEMO-2: becomes delayed at t=${first}, file says ${d2.expected.delayed_from_s}`);
  if (!near(d2.expected.delay_min_at_trigger, sim(d2.trigger.at_s).delay, 0.051) || !near(d2.expected.delay_min_after_hold, sim(holdEnd).delay, 0.051)) demoProblems.push('DEMO-2: delay figures do not re-derive');
  if (!(sim(d2.trigger.at_s).punctuality !== 'delayed')) demoProblems.push('DEMO-2: bus is already delayed before the trigger');
}
{
  const d3 = DEMO.get('DEMO-3');
  const t = TRIPS.get(d3.trigger.trip_id);
  const sc = SCENARIOS.get(t.scenario_id);
  if (t.status !== 'scheduled' || BUSES.get(t.bus_id).status !== 'idle') demoProblems.push('DEMO-3: trip must start scheduled with an idle bus');
  if (d3.trigger.at_s !== t.scheduled_start_offset_min * 60 || sc.starts_at_s !== d3.trigger.at_s) demoProblems.push('DEMO-3: trigger time, timetable and scenario start disagree');
  if (d3.trigger.at_stop_id !== LINES.get(`${t.route_id}|${t.direction}`).ids[0]) demoProblems.push('DEMO-3: trip must start at the first stop');
}
{
  const d4 = DEMO.get('DEMO-4');
  const { sim, sc } = SIMS.get('GPS-E');
  const o = sc.gps.outages[0];
  if (d4.trigger.last_fix_s !== o.last_fix_s || d4.trigger.restored_s !== o.restored_s) demoProblems.push('DEMO-4: trigger does not match the GPS-E outage');
  const f = sim(o.last_fix_s);
  const r = sim(o.restored_s);
  if (!near(d4.expected.last_fix.latitude, f.w.lat, 0.00002) || !near(d4.expected.on_restore.latitude, r.w.lat, 0.00002) || !near(d4.expected.on_restore.progress_km, r.km, 0.0015)) demoProblems.push('DEMO-4: last-fix / restore positions do not re-derive');
  if (d4.expected.unavailable_after_s !== o.last_fix_s + TH.unavailable_if_fix_age_s_over || d4.expected.stale_after_s !== o.last_fix_s + TH.live_if_fix_age_s_at_most) demoProblems.push('DEMO-4: thresholds do not match meta.thresholds');
}
{
  const e = DEMO.get('DEMO-5').expected;
  const count = (rows, k, v) => rows.filter((x) => x[k] === v).length;
  const done = data.trip_history.filter((h) => h.status === 'completed');
  const got = {
    fleet: { total: data.buses.length, active: count(data.buses, 'status', 'active'), idle: count(data.buses, 'status', 'idle'), offline: count(data.buses, 'status', 'offline'), maintenance: count(data.buses, 'status', 'maintenance') },
    trips_in_progress: count(data.trips, 'status', 'in_progress'),
    delayed_trips: data.trips.filter((t) => t.live?.punctuality === 'delayed').length,
    upcoming_trips: count(data.trips, 'status', 'scheduled'),
    alerts: { active: count(data.service_alerts, 'status', 'active'), scheduled: count(data.service_alerts, 'status', 'scheduled'), expired: count(data.service_alerts, 'status', 'expired'), draft: count(data.service_alerts, 'status', 'draft') },
    history_today: {
      completed: done.length,
      cancelled: count(data.trip_history, 'status', 'cancelled'),
      on_time: done.filter((h) => punctual(h.end_delay_min) === 'on_time').length,
      avg_end_delay_min: r1(done.reduce((a, h) => a + h.end_delay_min, 0) / done.length),
    },
  };
  if (JSON.stringify(got) !== JSON.stringify(e)) demoProblems.push(`DEMO-5: dashboard figures re-derive as ${JSON.stringify(got)}`);
}
check('demo stories 1-5 re-derive from the data (search, delay, start, GPS loss, dashboard)', demoProblems);

// -----------------------------------------------------------------------------
console.log('\nAlerts and history');
const alertProblems = [];
for (const a of data.service_alerts) {
  const s = a.starts_offset_min;
  const e = a.ends_offset_min;
  if (s !== null && e !== null && !(e > s)) alertProblems.push(`${a.id}: ends before it starts`);
  const ok = {
    draft: s === null,
    scheduled: s !== null && s > 0,
    active: s !== null && s <= 0 && (e === null || e > 0),
    expired: e !== null && e <= 0,
  }[a.status];
  if (!ok) alertProblems.push(`${a.id}: status ${a.status} does not fit its time window (${s}, ${e}) at T0`);
  if (/\bT0\b|\d{1,2}:\d{2}/.test(`${a.title} ${a.message}`)) alertProblems.push(`${a.id}: user-facing text contains a T0 reference or clock time`);
}
check('alert statuses match their time windows at T0', alertProblems);

const histProblems = [];
for (const h of data.trip_history) {
  const L = LINES.get(`${h.route_id}|${h.direction}`);
  if (h.scheduled_end_offset_min !== h.scheduled_start_offset_min + L.dur) histProblems.push(`${h.id}: scheduled_end != start + duration`);
  if (h.status === 'completed') {
    if (h.actual_end_offset_min !== h.scheduled_end_offset_min + h.end_delay_min) histProblems.push(`${h.id}: actual_end != scheduled_end + end_delay`);
    if (!(h.actual_end_offset_min < 0)) histProblems.push(`${h.id}: history trip ends after T0`);
  } else if (h.status === 'cancelled') {
    if (h.actual_start_offset_min !== null || h.end_delay_min !== null || !h.cancellation_reason) histProblems.push(`${h.id}: cancelled trip needs null actuals and a reason`);
  } else histProblems.push(`${h.id}: history rows must be completed or cancelled`);
}
check('trip history is in the past and arithmetically consistent', histProblems);

console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length > 0) {
  console.log(`Failed: ${failures.join('; ')}`);
  process.exit(1);
}
