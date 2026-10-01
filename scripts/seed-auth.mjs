/**
 * Creates the four demo auth accounts (one per role) and links them to the
 * demo profiles that supabase/seed.sql already loaded.
 *
 *   node scripts/seed-auth.mjs
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.
 * The service role key is read server-side only and never reaches the browser.
 *
 * The on_auth_user_created trigger (migration 5) adopts the matching profile by
 * email, so each account keeps the role from the seed rather than creating a
 * duplicate profile.
 *
 * Idempotent: an account that already exists is skipped.
 */
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const DEMO_PASSWORD = 'demo-transit-2026';

const ACCOUNTS = [
  { email: 'sana.fatima@demo.invalid', full_name: 'Sana Fatima', role: 'passenger' },
  { email: 'm.asif@demo.invalid', full_name: 'Muhammad Asif', role: 'driver' },
  { email: 'ayesha.siddiqui@demo.invalid', full_name: 'Ayesha Siddiqui', role: 'operator' },
  { email: 'hamza.qureshi@demo.invalid', full_name: 'Hamza Qureshi', role: 'admin' },
];

// Minimal .env.local reader so the script needs no extra dependency.
async function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    try {
      const text = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
      for (const line of text.split('\n')) {
        const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (match && !process.env[match[1]]) {
          process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
        }
      }
    } catch {
      // file is optional
    }
  }
}

await loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  console.error('Copy .env.example to .env.local and fill them in first.');
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let created = 0;
let skipped = 0;
let failed = 0;

for (const account of ACCOUNTS) {
  const { data, error } = await admin.auth.admin.createUser({
    email: account.email,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: account.full_name, role: account.role },
  });

  if (error) {
    if (/already (been )?registered|already exists/i.test(error.message)) {
      console.log(`  skip    ${account.role.padEnd(9)} ${account.email} (already exists)`);
      skipped += 1;
    } else {
      console.log(`  FAIL    ${account.role.padEnd(9)} ${account.email} - ${error.message}`);
      failed += 1;
    }
    continue;
  }

  console.log(`  created ${account.role.padEnd(9)} ${account.email} -> ${data.user?.id}`);
  created += 1;
}

// Confirm the trigger linked each account to its seeded profile.
const { data: profiles, error: profileError } = await admin
  .from('profiles')
  .select('email, role, auth_user_id')
  .in('email', ACCOUNTS.map((a) => a.email));

console.log(`\n${created} created, ${skipped} already existed, ${failed} failed`);

if (profileError) {
  console.log(`Could not verify profile links: ${profileError.message}`);
} else {
  const linked = profiles.filter((p) => p.auth_user_id !== null);
  console.log(`Profiles linked to an auth user: ${linked.length}/${ACCOUNTS.length}`);
  for (const p of profiles) {
    console.log(`  ${p.auth_user_id ? 'linked  ' : 'UNLINKED'} ${p.role.padEnd(9)} ${p.email}`);
  }
  if (linked.length !== ACCOUNTS.length) {
    console.log('Unlinked rows mean migration 5 (on_auth_user_created) is not applied.');
  }
}

console.log(`\nPassword for all demo accounts: ${DEMO_PASSWORD}`);
if (failed > 0) process.exit(1);
