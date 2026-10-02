import Link from 'next/link';
import { Suspense } from 'react';

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

  return (
    <AppShell bleed title="Live map">
      <Suspense fallback={<div className="h-full w-full bg-[#e6e0d4]" />}>
        <TrackData boarding={boarding} destination={destination} tripId={tripId} />
      </Suspense>
    </AppShell>
  );
}

async function TrackData({
  tripId,
  boarding,
  destination,
}: {
  tripId: string;
  boarding?: string;
  destination?: string;
}) {
  let trip: TripLive | null = null;
  let etas: TripStopEta[] = [];
  let path: RoutePathStop[] = [];
  let loadError: string | null = null;

  try {
    const [loadedTrip, loadedEtas] = await Promise.all([getTripLive(tripId), getTripStopEtas(tripId)]);
    trip = loadedTrip;
    etas = loadedEtas;
    if (trip) path = await getRoutePath(trip.route_id, trip.direction);
  } catch (error) {
    loadError = error instanceof Error ? error.message : 'Database request failed.';
  }

  if (loadError) {
    return (
      <>
        <ErrorState title="Could not load this trip" detail={loadError} />
        <Link className="absolute bottom-4 left-4 z-10 text-sm text-white underline" href="/">
          Back to search
        </Link>
      </>
    );
  }

  if (!trip) {
    return (
      <>
        <ErrorState
          title="Trip not found"
          detail="This trip does not exist. It may have been removed when the demo data was reloaded."
        />
        <Link className="absolute bottom-4 left-4 z-10 text-sm underline" href="/">
          Back to search
        </Link>
      </>
    );
  }

  return (
    <>
      <TrackingView
        boardingStopId={boarding ?? null}
        destinationStopId={destination ?? null}
        initialEtas={etas}
        initialTrip={trip}
        path={path}
      />
      <DemoDataNotice />
    </>
  );
}
