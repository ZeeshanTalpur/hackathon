import { AppShell, DemoDataNotice, ErrorState } from '@/components/app-shell';
import { requireRole } from '@/lib/auth';
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

  const session = await requireRole(['driver', 'operator', 'admin']);

  // Data fetching is wrapped, not the JSX: a try/catch cannot catch render
  // errors, so constructing elements inside it would be misleading.
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
    return (
      <AppShell title="Driver">
        <ErrorState title="Could not load your trips" detail={loadError} />
      </AppShell>
    );
  }

  return (
    <AppShell title="Driver">
      <p className="text-sm opacity-70">
        {session.profile?.full_name ?? session.email} - signed in as {session.role}
      </p>
      <DriverConsole initialTrips={trips} linked={linked} />
      <DemoDataNotice />
    </AppShell>
  );
}
