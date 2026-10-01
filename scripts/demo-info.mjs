#!/usr/bin/env node
/** Prints the identifiers needed to walk the demo by hand. */
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const text = await readFile('.env.local', 'utf8');
const get = (k) => (text.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();
const db = createClient(get('NEXT_PUBLIC_SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'));

const { data: trips } = await db
  .from('v_trip_live')
  .select('trip_id, trip_code, status, route_id, route_code, registration_no, driver_name, progress_km, route_distance_km, operational_state')
  .order('status');

console.log('\nTrips:');
for (const t of trips ?? []) {
  console.log(
    `  ${t.trip_code}  ${t.status.padEnd(12)} ${t.route_code}  ${t.registration_no}  ` +
      `${Number(t.progress_km).toFixed(1)}/${Number(t.route_distance_km).toFixed(1)} km  ` +
      `${t.operational_state}  driver=${t.driver_name ?? '-'}`,
  );
}

const byRoute = new Map();
for (const t of trips ?? []) {
  if (!byRoute.has(t.route_code)) byRoute.set(t.route_code, t.route_id);
}

for (const [code, routeId] of byRoute) {
  const { data: path } = await db.rpc('fn_route_path', {
    p_route_id: routeId,
    p_direction: 'outbound',
  });
  const names = (path ?? []).map((s) => s.stop_name);
  console.log(`\n${code} outbound stops (${names.length}):`);
  console.log(`  first: ${names[0]}`);
  console.log(`  last:  ${names[names.length - 1]}`);
}

const { data: drivers } = await db
  .from('drivers')
  .select('full_name, profile_id, profiles(email, role)');
console.log('\nDrivers linked to a profile:');
for (const d of drivers ?? []) {
  if (d.profiles) console.log(`  ${d.full_name} -> ${d.profiles.email} (${d.profiles.role})`);
}
