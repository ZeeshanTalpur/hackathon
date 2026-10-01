import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Refreshes the Supabase auth session on each request and writes the rotated
 * cookies onto the response.
 *
 * This is `proxy.ts`, not `middleware.ts`: the middleware file convention is
 * deprecated in Next.js 16 and renamed to proxy. The exported function must be
 * the default export or named `proxy`.
 *
 * Server Components cannot set cookies, so without this the refreshed token is
 * computed and then dropped, and the user is signed out when the access token
 * expires.
 *
 * No route protection here - gating lives in `requireRole()` next to the pages
 * that need it, because proxy runs before rendering and may be served from a
 * CDN edge.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Without credentials there is no session to refresh; let the request through
  // so the app still renders before Supabase is configured.
  if (!url || !anonKey) return response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  await supabase.auth.getUser();

  return response;
}

export const config = {
  // Skip static assets and image optimisation, otherwise this runs on every
  // CSS, JS and image request.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
