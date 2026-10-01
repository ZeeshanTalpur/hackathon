import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';

/**
 * Foundation health check. Validates, in one request:
 *   - env vars are present
 *   - the Supabase connection works with the anon key
 *   - the schema is applied (v_fleet_overview resolves)
 *   - the demo seed is loaded (counts are non-zero)
 *   - whether anyone is signed in
 *
 * GET /api/health
 */
export async function GET() {
  const envPresent = {
    NEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY),
  };

  if (!envPresent.NEXT_PUBLIC_SUPABASE_URL || !envPresent.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.json(
      {
        ok: false,
        reason: 'Supabase env vars missing. Copy .env.example to .env.local and fill it in.',
        env: envPresent,
      },
      { status: 503 },
    );
  }

  const supabase = await createClient();

  const [overview, user] = await Promise.all([
    supabase.from('v_fleet_overview').select('*').single(),
    supabase.auth.getUser(),
  ]);

  if (overview.error) {
    return NextResponse.json(
      {
        ok: false,
        reason: 'Connected to Supabase but could not read v_fleet_overview. Are the migrations applied?',
        error: overview.error.message,
        env: envPresent,
      },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: true,
    env: envPresent,
    schema: 'v_fleet_overview resolved',
    seed: overview.data,
    seedLoaded: (overview.data?.total_buses ?? 0) > 0,
    signedIn: Boolean(user.data.user),
    note: 'Transport data is DEMO / SIMULATED hackathon data.',
  });
}
