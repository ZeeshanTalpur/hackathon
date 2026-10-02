import Link from 'next/link';

import { AppShell, DemoDataNotice, ErrorState } from '@/components/app-shell';
import {
  SUPABASE_CONFIGURED,
  getRoutePath,
  getTripLive,
  getTripStopEtas,
} from '@/lib/data/transit';
import type { RoutePathStop, TripLive, TripStopEta } from '@/lib/types/database';

import { TrackingView } from './tracking-view';

export const dynamic = 'force-dynamic';

interface TrackPageProps {
  params: Promise<{ tripId: string }>;
  searchParams: Promise<{ destination?: string; boarding?: string }>;
}

export default async function TrackPage({ params, searchParams }: TrackPageProps) {
  const { tripId } = await params;
  const { destination, boarding } = await searchParams;

  if (!SUPABASE_CONFIGURED) {
    return (
      <AppShell title="Your bus">
        <ErrorState
          title="Supabase is not configured"
          detail="Copy .env.example to .env.local and restart the dev server."
        />
      </AppShell>
    );
  }

  // Fetch first, render second: JSX inside a try/catch would not actually
  // catch render errors.
  let trip: TripLive | null = null;
  let etas: TripStopEta[] = [];
  let path: RoutePathStop[] = [];
  let loadError: string | null = null;

  try {
    trip = await getTripLive(tripId);
    if (trip) {
      [etas, path] = await Promise.all([
        getTripStopEtas(tripId),
        getRoutePath(trip.route_id, trip.direction),
      ]);
    }
  } catch (error) {
    loadError = error instanceof Error ? error.message : 'Database request failed.';
  }

  if (loadError) {
    return (
      <AppShell title="Your bus">
        <ErrorState title="Could not load this trip" detail={loadError} />
        <Link className="text-sm underline" href="/">
          Back to search
        </Link>
      </AppShell>
    );
  }

  if (!trip) {
    return (
      <AppShell title="Your bus">
        <ErrorState
          title="Trip not found"
          detail="This trip does not exist. It may have been removed when the demo data was reloaded."
        />
        <Link className="text-sm underline" href="/">
          Back to search
        </Link>
      </AppShell>
    );
  }

  return (
    <AppShell bleed title="Live map">
      <TrackingView
        boardingStopId={boarding ?? null}
        destinationStopId={destination ?? null}
        initialEtas={etas}
        initialTrip={trip}
        path={path}
      />
      <DemoDataNotice />
    </AppShell>
  );
}
