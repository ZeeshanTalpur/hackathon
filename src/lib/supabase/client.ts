import { createBrowserClient } from '@supabase/ssr';

import type { Database } from '@/lib/types/database';

/**
 * Supabase client for Client Components. Uses the anon key, so Row Level
 * Security applies. Safe to call on every render - the underlying client is
 * memoised by @supabase/ssr.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
