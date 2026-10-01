#!/usr/bin/env node
/** Minimal probe: does a bus_locations INSERT reach an anon subscriber? */
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const text = await readFile('.env.local', 'utf8');
const get = (k) => (text.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();

const sub = createClient(get('NEXT_PUBLIC_SUPABASE_URL'), get('NEXT_PUBLIC_SUPABASE_ANON_KEY'));
const admin = createClient(get('NEXT_PUBLIC_SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'));

const events = [];
let status = null;

const channel = sub
  .channel('probe')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'bus_locations' }, (p) => {
    events.push(p.eventType);
  })
  .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, (p) => {
    events.push(`trips:${p.eventType}`);
  })
  .subscribe((s) => {
    status = s;
    console.log('channel status:', s);
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 100 && status !== 'SUBSCRIBED'; i += 1) await sleep(200);
console.log('subscribed:', status);

// Give the service a moment to attach its replication slot.
await sleep(2000);

const { data: bus } = await admin.from('buses').select('id').limit(1).single();
const { error } = await admin.from('bus_locations').insert({
  bus_id: bus.id,
  latitude: 24.86,
  longitude: 67.01,
  speed_kmh: 11,
  source: 'manual',
});
console.log('insert error:', error?.message ?? 'none');

for (let i = 0; i < 150 && events.length === 0; i += 1) await sleep(200);
console.log('events received:', events.length, events.join(', ') || '(none)');

await sub.removeChannel(channel);
process.exit(events.length > 0 ? 0 : 1);
