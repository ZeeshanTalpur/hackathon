import Link from 'next/link';

import { StatusBadge, formatDelay } from '@/components/trip-status';
import { AppShell, DemoDataNotice, EmptyState, ErrorState } from '@/components/app-shell';
import {
  SUPABASE_CONFIGURED,
  activeTripsForRoute,
  listStops,
  searchRoutes,
} from '@/lib/data/transit';
import type { RouteSearchResult, Stop, TripLive } from '@/lib/types/database';

export const dynamic = 'force-dynamic';

interface HomeProps {
  searchParams: Promise<{ origin?: string; destination?: string }>;
}

export default async function Home({ searchParams }: HomeProps) {
  const { origin, destination } = await searchParams;

  if (!SUPABASE_CONFIGURED) {
    return (
      <AppShell title="Find your bus">
        <ErrorState
          title="Supabase is not configured"
          detail="Copy .env.example to .env.local, fill in the project URL and anon key, then restart the dev server."
        />
      </AppShell>
    );
  }

  let stops: Stop[] = [];
  let loadError: string | null = null;
  try {
    stops = await listStops();
  } catch (error) {
    loadError = error instanceof Error ? error.message : 'Could not reach the database.';
  }

  if (loadError) {
    return (
      <AppShell title="Find your bus">
        <ErrorState title="Could not load stops" detail={loadError} />
      </AppShell>
    );
  }

  const searched = Boolean(origin && destination);
  const sameStop = searched && origin === destination;

  let routes: RouteSearchResult[] = [];
  let tripsByRoute = new Map<string, TripLive[]>();
  let searchError: string | null = null;

  if (searched && !sameStop) {
    try {
      routes = await searchRoutes(origin!, destination!);
      const lists = await Promise.all(routes.map((r) => activeTripsForRoute(r.route_id)));
      tripsByRoute = new Map(routes.map((r, i) => [r.route_id, lists[i]]));
    } catch (error) {
      searchError = error instanceof Error ? error.message : 'Search failed.';
    }
  }

  return (
    <AppShell title="Find your bus">
      <form className="flex flex-col gap-3 rounded border border-black/15 p-4 dark:border-white/15">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">From</span>
          <StopSelect name="origin" stops={stops} value={origin} />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">To</span>
          <StopSelect name="destination" stops={stops} value={destination} />
        </label>

        <button
          className="rounded bg-foreground px-4 py-2.5 text-sm font-medium text-background"
          type="submit"
        >
          Search routes
        </button>
      </form>

      {sameStop ? (
        <EmptyState title="Pick two different stops" detail="Origin and destination are the same." />
      ) : null}

      {searchError ? <ErrorState title="Search failed" detail={searchError} /> : null}

      {searched && !sameStop && !searchError && routes.length === 0 ? (
        <EmptyState
          title="No direct route found"
          detail="No single route serves both stops in that order. This demo searches direct routes only - it does not plan journeys with transfers."
        />
      ) : null}

      {routes.map((route) => {
        const trips = tripsByRoute.get(route.route_id) ?? [];
        const live = trips.filter((t) => t.status === 'in_progress');
        const upcoming = trips.filter((t) => t.status === 'scheduled');

        return (
          <section
            key={`${route.route_id}-${route.direction}`}
            className="flex flex-col gap-3 rounded border border-black/15 p-4 dark:border-white/15"
          >
            <header className="flex flex-wrap items-center gap-2">
              <span
                className="rounded px-2 py-0.5 text-xs font-semibold text-white"
                style={{ backgroundColor: route.route_color }}
              >
                {route.route_code}
              </span>
              <h2 className="text-sm font-medium">{route.route_name}</h2>
              <span className="text-xs opacity-60">{route.direction}</span>
            </header>

            <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <Fact label="Distance" value={`${Number(route.distance_km).toFixed(1)} km`} />
              <Fact label="Scheduled" value={`${route.estimated_duration_min} min`} />
              <Fact label="Fare" value={`PKR ${route.fare_pkr}`} />
              <Fact label="Stops between" value={String(route.intermediate_stops)} />
            </dl>

            {live.length === 0 && upcoming.length === 0 ? (
              <EmptyState
                title="No buses on this route right now"
                detail="A driver needs to start a trip before live tracking is available."
              />
            ) : null}

            {live.length > 0 ? (
              <div className="flex flex-col gap-2">
                <h3 className="text-xs font-medium uppercase tracking-wide opacity-60">
                  Live buses
                </h3>
                {live.map((trip) => (
                  <TripRow key={trip.trip_id} trip={trip} />
                ))}
              </div>
            ) : null}

            {upcoming.length > 0 ? (
              <div className="flex flex-col gap-2">
                <h3 className="text-xs font-medium uppercase tracking-wide opacity-60">
                  Not yet departed
                </h3>
                {upcoming.slice(0, 3).map((trip) => (
                  <TripRow key={trip.trip_id} trip={trip} />
                ))}
              </div>
            ) : null}
          </section>
        );
      })}

      <DemoDataNotice />
    </AppShell>
  );
}

function StopSelect({
  name,
  stops,
  value,
}: {
  name: string;
  stops: Stop[];
  value?: string;
}) {
  return (
    <select
      className="rounded border border-black/20 bg-transparent px-3 py-2.5 text-sm dark:border-white/20"
      defaultValue={value ?? ''}
      name={name}
      required
    >
      <option value="" disabled>
        Select a stop
      </option>
      {stops.map((stop) => (
        <option key={stop.id} value={stop.id}>
          {stop.name}
          {stop.area ? ` - ${stop.area}` : ''}
        </option>
      ))}
    </select>
  );
}

function TripRow({ trip }: { trip: TripLive }) {
  const delay = formatDelay(trip.delay_minutes);
  const trackable = trip.status === 'in_progress';

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-black/10 p-3 text-sm dark:border-white/10">
      <div className="flex flex-col gap-1">
        <span className="font-medium">
          {trip.registration_no}
          {trip.bus_label ? ` - ${trip.bus_label}` : ''}
        </span>
        <span className="text-xs opacity-70">
          {trip.trip_code}
          {trip.next_stop_name ? ` - next: ${trip.next_stop_name}` : ''}
        </span>
        {delay ? <span className="text-xs text-amber-600">{delay}</span> : null}
      </div>

      <div className="flex items-center gap-3">
        <StatusBadge state={trip.operational_state} />
        {trackable ? (
          <Link
            className="rounded bg-foreground px-3 py-1.5 text-xs font-medium text-background"
            href={`/track/${trip.trip_id}`}
          >
            Track live
          </Link>
        ) : (
          <span className="text-xs opacity-60">Not started</span>
        )}
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="opacity-60">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
