#!/usr/bin/env node
/**
 * Proves the live-tracking path end to end against the real project:
 *
 *   driver write -> Postgres -> Supabase Realtime -> passenger client
 *
 * Subscribes with the anon key exactly as the browser does, then performs a
 * driver action with the service-role key and waits for the broadcast.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const root = process.cwd();
const text = await readFile(path.join(root, '.env.local'), 'utf8');
const get = (key) => (text.match(new RegExp(`^${key}=(.*)$`, 'm')) || [])[1]?.trim();

const url = get('NEXT_PUBLIC_SUPABASE_URL');
const anon = get('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const service = get('SUPABASE_SERVICE_ROLE_KEY');

const passenger = createClient(url, anon, { realtime: { params: { eventsPerSecond: 10 } } });
const driver = createClient(url, service);

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failures += 1;
};

// Pick a running trip with room left to move, so the ticks below cannot drive
// it past the final stop and auto-complete it mid-test.
const { data: candidates, error: tripError } = await driver
  .from('v_trip_live')
  .select('*')
  .eq('status', 'in_progress')
  .order('trip_code');

const trips = (candidates ?? []).filter(
  (t) => Number(t.route_distance_km) - Number(t.progress_km) > 6,
);

if (tripError) {
  console.error('Could not read v_trip_live:', tripError.message);
  process.exit(1);
}

const trip = trips?.[0];
check('found an in-progress demo trip', Boolean(trip), trip?.trip_code);
if (!trip) process.exit(1);

console.log(`\nTrip ${trip.trip_code} on ${trip.route_code}, bus ${trip.registration_no}`);
console.log(`  progress ${trip.progress_km} km, state ${trip.operational_state}`);

// Subscribe the way the tracking page does.
const received = [];
let subscribeStatus = null;

const channel = passenger
  .channel(`test-trip-${trip.trip_id}`)
  .on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'bus_locations',
      filter: `bus_id=eq.${trip.bus_id}`,
    },
    (payload) => received.push(payload.new),
  )
  .subscribe((status) => {
    subscribeStatus = status;
  });

const waitFor = async (predicate, timeoutMs, step = 150) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, step));
  }
  return false;
};

const subscribed = await waitFor(() => subscribeStatus === 'SUBSCRIBED', 20_000);
check('passenger client subscribed to realtime', subscribed, String(subscribeStatus));

if (!subscribed) {
  await passenger.removeChannel(channel);
  process.exit(1);
}

// Driver action: one simulation tick.
const before = trip;
const { error: tickError } = await driver.rpc('fn_advance_trip', {
  p_trip_id: trip.trip_id,
  p_tick_seconds: 120,
  p_speed_kmh: 32,
});
check('driver tick accepted', !tickError, tickError?.message);

const got = await waitFor(() => received.length > 0, 20_000);
check('passenger received the location event over realtime', got,
  got ? `${received.length} event(s)` : 'timed out after 20s');

if (got) {
  const fix = received[0];
  check('event carries usable coordinates',
    Number.isFinite(Number(fix.latitude)) && Number.isFinite(Number(fix.longitude)),
    `${fix.latitude}, ${fix.longitude}`);
  check('event position is inside Karachi',
    Number(fix.latitude) > 24.6 && Number(fix.latitude) < 25.2
      && Number(fix.longitude) > 66.8 && Number(fix.longitude) < 67.4);
  check('event reports the simulated speed', Number(fix.speed_kmh) === 32, `${fix.speed_kmh} km/h`);
}

// Derived state must have moved too.
const { data: after } = await driver
  .from('v_trip_live')
  .select('*')
  .eq('trip_id', trip.trip_id)
  .single();

check('progress advanced after the tick',
  Number(after.progress_km) > Number(before.progress_km),
  `${before.progress_km} -> ${after.progress_km}`);
check('coordinates changed after the tick',
  after.latitude !== before.latitude || after.longitude !== before.longitude,
  `${after.latitude}, ${after.longitude}`);

// ETA must respond to movement.
const etaFor = async () => {
  const { data } = await driver
    .from('v_trip_stop_eta')
    .select('stop_order, stop_name, eta_minutes')
    .eq('trip_id', trip.trip_id)
    .order('stop_order')
    .limit(1);
  return data?.[0];
};

const etaBefore = await etaFor();
// Small advance: enough to change the ETA, not enough to pass the stop.
await driver.rpc('fn_advance_trip', {
  p_trip_id: trip.trip_id,
  p_tick_seconds: 60,
  p_speed_kmh: 20,
});
const etaAfter = await etaFor();

check('ETA is produced for the next stop', Boolean(etaBefore), `${etaBefore?.eta_minutes} min`);
if (etaBefore && etaAfter && etaBefore.stop_order === etaAfter.stop_order) {
  check('ETA falls as the bus closes in',
    Number(etaAfter.eta_minutes) < Number(etaBefore.eta_minutes),
    `${etaBefore.eta_minutes} -> ${etaAfter.eta_minutes} min to ${etaAfter.stop_name}`);
} else {
  check('ETA target advanced to a later stop', Boolean(etaAfter),
    `next stop is now ${etaAfter?.stop_name}`);
}

// Delay must propagate to the passenger-facing state.
await driver.rpc('fn_set_trip_delay', { p_trip_id: trip.trip_id, p_delay_minutes: 14 });
const { data: delayed } = await driver
  .from('v_trip_live')
  .select('delay_minutes, is_delayed, operational_state')
  .eq('trip_id', trip.trip_id)
  .single();

check('delay is stored', Number(delayed.delay_minutes) === 14);
check('delayed trip reports DELAYED', delayed.operational_state === 'DELAYED',
  delayed.operational_state);

// Anonymous read must work - this is what the passenger browser does.
const { data: anonRead, error: anonError } = await passenger
  .from('v_trip_live')
  .select('trip_code, operational_state, latitude, longitude')
  .eq('trip_id', trip.trip_id)
  .single();

check('anonymous passenger can read live trip state', !anonError && Boolean(anonRead),
  anonError?.message ?? anonRead?.operational_state);

await passenger.removeChannel(channel);

console.log(`\n${failures === 0 ? 'All realtime checks passed' : `${failures} check(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
