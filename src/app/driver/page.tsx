import { Suspense } from 'react';

import { AppShell, DemoDataNotice, ErrorState } from '@/components/app-shell';
import { requireRole, type SessionContext } from '@/lib/auth';
import { SUPABASE_CONFIGURED, driverTrips } from '@/lib/data/transit';
import type { TripLive } from '@/lib/types/database';

import { DriverConsole } from './driver-console';

export const dynamic = 'force-dynamic';

export default async function DriverPage() {
  if (!SUPABASE_CONFIGURED) {
    return (
      <AppShell title="Driver">
        <ErrorState
          title="Supabase is not configured"
          detail="Copy .env.example to .env.local and restart the dev server."
        />
      </AppShell>
    );
  }

  const session = await requireRole(['driver']);

  return (
    <AppShell title="Your run">
      <div className="flex items-center justify-between text-sm text-slate-500">
        <p>{session.profile?.full_name ?? 'Driver'}</p>
        <form action="/auth/sign-out" method="post">
          <button className="min-h-11 px-2 text-slate-500 underline" type="submit">
            Sign out
          </button>
        </form>
      </div>
      <Suspense fallback={<div className="h-72 animate-pulse rounded-3xl bg-white" />}>
        <DriverBoard session={session} />
      </Suspense>
    </AppShell>
  );
}

async function DriverBoard({ session }: { session: SessionContext }) {
  let trips: TripLive[] = [];
  let linked = false;
  let loadError: string | null = null;

  try {
    const result = await driverTrips(session.profile?.id ?? null);
    trips = result.trips;
    linked = result.linked;
  } catch (error) {
    loadError = error instanceof Error ? error.message : 'Database request failed.';
  }

  if (loadError) {
    return <ErrorState title="Could not load your trips" detail={loadError} />;
  }

  return (
    <>
      <DriverConsole initialTrips={trips} linked={linked} />
      <DemoDataNotice />
    </>
  );
}
