import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

import type { Database } from '@/lib/types/database';

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 * Uses the anon key, so Row Level Security applies.
 *
 * `cookies()` is async in Next.js 16, hence the await.
 *
 * Server Components cannot set cookies. The try/catch around setAll is the
 * documented Supabase pattern: a refreshed token is written by proxy.ts, and
 * the throw here is expected and safe to swallow.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component; proxy.ts refreshes the session.
          }
        },
      },
    },
  );
}
