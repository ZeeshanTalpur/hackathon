import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/lib/types/database';

/**
 * Service-role Supabase client. BYPASSES ROW LEVEL SECURITY.
 *
 * The `server-only` import makes the build fail if this module is ever reached
 * from a Client Component, which is the guard that keeps the key off the client.
 *
 * Use it only for trusted server work: the GPS feed write path and demo
 * seeding. Never for handling user-supplied queries.
 */
export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. Add it to .env.local for server-side writes.',
    );
  }

  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
