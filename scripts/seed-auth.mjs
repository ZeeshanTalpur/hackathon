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

console.log(`\n${created} created, ${skipped} already existed, ${failed} failed`);

// Repair the profile links.
//
// The on_auth_user_created trigger only fires when an auth user is inserted, so
// re-running supabase/seed.sql (which truncates and reloads profiles) leaves
// existing accounts orphaned. Re-link by email here so the two seeding steps
// can be run in any order, any number of times.
const { data: authUsers, error: listError } = await admin.auth.admin.listUsers({
  page: 1,
  perPage: 200,
});

if (listError) {
  console.log(`Could not list auth users: ${listError.message}`);
} else {
  let relinked = 0;
  for (const account of ACCOUNTS) {
    const user = authUsers.users.find((u) => u.email === account.email);
    if (!user) continue;

    const { data: updated, error: linkError } = await admin
      .from('profiles')
      .update({ auth_user_id: user.id, role: account.role })
      .eq('email', account.email)
      .is('auth_user_id', null)
      .select('email');

    if (linkError) {
      console.log(`  link failed ${account.email}: ${linkError.message}`);
    } else if (updated && updated.length > 0) {
      relinked += 1;
    }
  }
  if (relinked > 0) console.log(`Re-linked ${relinked} profile(s) to existing auth users.`);
}

const { data: profiles, error: profileError } = await admin
  .from('profiles')
  .select('email, role, auth_user_id')
  .in('email', ACCOUNTS.map((a) => a.email));

if (profileError) {
  console.log(`Could not verify profile links: ${profileError.message}`);
} else {
  const linked = profiles.filter((p) => p.auth_user_id !== null);
  console.log(`Profiles linked to an auth user: ${linked.length}/${ACCOUNTS.length}`);
  for (const p of profiles) {
    console.log(`  ${p.auth_user_id ? 'linked  ' : 'UNLINKED'} ${p.role.padEnd(9)} ${p.email}`);
  }
  if (linked.length !== ACCOUNTS.length) {
    console.log('Unlinked rows mean the profiles seed has no row with that email.');
  }
}

console.log(`\nPassword for all demo accounts: ${DEMO_PASSWORD}`);
if (failed > 0) process.exit(1);
