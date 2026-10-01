import Link from 'next/link';
import type { ReactNode } from 'react';

import { StatusBadge, formatDelay, formatEta } from '@/components/trip-status';
import { AppShell, ErrorState } from '@/components/app-shell';
import {
  SUPABASE_CONFIGURED,
  activeAlerts,
  activeTripsForRoute,
  arrivalsAtStop,
  departuresNearStop,
  listStops,
  operatorTrips,
  scheduleBoard,
  searchRoutes,
} from '@/lib/data/transit';
import type { Stop, StopArrival, TripLive } from '@/lib/types/database';

export const dynamic = 'force-dynamic';

interface HomeProps {
  searchParams: Promise<{ origin?: string; destination?: string; stop?: string }>;
}

export default async function Home({ searchParams }: HomeProps) {
  const { origin, destination, stop } = await searchParams;

  if (!SUPABASE_CONFIGURED) {
    return (
      <AppShell title="Find a bus">
        <ErrorState title="Service unavailable" detail="The timetable could not be reached." />
      </AppShell>
    );
  }

  let stops: Stop[] = [];
  let alerts: { id: string; title: string; message: string }[] = [];
  let schedules: Awaited<ReturnType<typeof scheduleBoard>> = [];
  let running: TripLive[] = [];
  let arrivals: StopArrival[] = [];
  let loadError: string | null = null;
  try {
    [stops, alerts, schedules, running] = await Promise.all([
      listStops(),
      activeAlerts(),
      scheduleBoard(),
      operatorTrips(),
    ]);
    if (stop) arrivals = await arrivalsAtStop(stop);
  } catch (error) {
    loadError = error instanceof Error ? error.message : 'Could not reach the timetable.';
  }

  if (loadError) {
    return (
      <AppShell title="Find a bus">
        <ErrorState title="Could not load stops" detail={loadError} />
      </AppShell>
    );
  }

  const searched = Boolean(origin && destination);
  const sameStop = searched && origin === destination;
  const originName = stops.find((stop) => stop.id === origin)?.name;

  let buses: TripLive[] = [];
  let heading = 'Choose a bus';
  let note: string | null = null;
  let searchError: string | null = null;

  if (searched && !sameStop) {
    try {
      const routes = await searchRoutes(origin!, destination!);
      if (routes.length > 0) {
        const lists = await Promise.all(routes.map((route) => activeTripsForRoute(route.route_id)));
        buses = lists.flat().sort(byDeparture);
        heading = routes.length === 1 ? routes[0].route_name : 'Buses that stop at both';
        if (buses.length === 0) {
          buses = await departuresNearStop(origin!);
          heading = 'Next departures';
          note = `Nothing is running that exact trip right now. These leave from ${originName ?? 'your stop'} soonest.`;
        }
      } else {
        buses = await departuresNearStop(origin!);
        heading = 'Next departures';
        note = `These are the nearest buses from ${originName ?? 'your stop'}.`;
      }
    } catch (error) {
      searchError = error instanceof Error ? error.message : 'Search failed.';
    }
  }

  return (
    <AppShell title="Find a bus">
      <div className="grid items-start gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <form className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <Field label="From">
              <StopSelect name="origin" stops={stops} value={origin} />
            </Field>
            <Field label="To">
              <StopSelect name="destination" stops={stops} value={destination} />
            </Field>
            <button
              className="rounded-xl bg-[#2563eb] px-4 py-3 text-sm font-medium text-white hover:bg-[#1d4ed8]"
              type="submit"
            >
              Show buses
            </button>
            {sameStop ? <p className="text-sm text-slate-500">Choose two different stops.</p> : null}
          </form>

          <section className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-sm font-medium">At a stop</h2>
            <form className="flex flex-col gap-2">
              <select
                className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"
                defaultValue={stop ?? ''}
                name="stop"
                required
              >
                <option value="" disabled>
                  Choose a stop
                </option>
                {stops.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <button className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white" type="submit">
                Approaching buses
              </button>
            </form>
            {stop && arrivals.length === 0 ? (
              <p className="text-sm text-slate-500">No bus is due at this stop yet.</p>
            ) : null}
            <ul className="flex flex-col gap-2">
              {arrivals.map((arrival) => (
                <li key={arrival.trip_id}>
                  <Link
                    className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5"
                    href={`/track/${arrival.trip_id}?destination=${stop}`}
                  >
                    <span>
                      <span className="block text-sm font-medium">{arrival.route_name}</span>
                      <span className="text-sm text-slate-500">
                        {formatEta(arrival.eta_minutes)}
                        {Number(arrival.projected_delay_minutes) >= 5 ? ' · Delayed' : ''}
                      </span>
                    </span>
                    <span className="text-sm font-medium text-[#2563eb]">Track</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="flex flex-col gap-6">
          {searchError ? <ErrorState title="Search failed" detail={searchError} /> : null}

          {searched && !sameStop && !searchError ? (
            <section className="flex flex-col gap-3">
              <div>
                <h2 className="text-base font-semibold tracking-tight">{heading}</h2>
                {note ? (
                  <p className="mt-1 text-sm text-slate-500">{note}</p>
                ) : (
                  <p className="mt-1 text-sm text-slate-500">
                    {buses.length === 1 ? '1 bus' : `${buses.length} buses`}. Choose one to follow it on the map.
                  </p>
                )}
              </div>
              <ul className="flex flex-col gap-2">
                {buses.map((trip) => (
                  <li key={trip.trip_id}>
                    <BusChoice destination={destination} trip={trip} />
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <p className="text-xs font-semibold tracking-[0.14em] text-[#2563eb] uppercase">Ride</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">See the next bus before you leave.</h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
                Pick two stops. Every bus on that trip is listed, and the one you choose opens on a live map
                with its next stop and arrival time.
              </p>
            </section>
          )}

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Notifications</h2>
            {alerts.length === 0 && running.every((trip) => !trip.is_delayed) ? (
              <p className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-500 ring-1 ring-slate-200">
                No service notices right now.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {alerts.map((alert) => (
                  <li key={alert.id} className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-950 ring-1 ring-amber-100">
                    <p className="font-medium">{alert.title}</p>
                    <p className="mt-1">{alert.message}</p>
                  </li>
                ))}
                {running
                  .filter((trip) => trip.status === 'in_progress' && trip.is_delayed)
                  .map((trip) => (
                    <li key={trip.trip_id} className="rounded-2xl bg-white px-4 py-3 text-sm ring-1 ring-slate-200">
                      <p className="font-medium">{trip.bus_label ?? 'Bus'} is delayed</p>
                      <p className="mt-1 text-slate-500">
                        {trip.route_name}
                        {formatDelay(trip.delay_minutes) ? ` · ${formatDelay(trip.delay_minutes)}` : ''}
                      </p>
                    </li>
                  ))}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Schedules</h2>
            <ul className="grid grid-cols-1 gap-2 xl:grid-cols-2">
              {schedules
                .filter((route) => route.is_active)
                .map((route) => (
                  <li key={route.route_id} className="rounded-2xl bg-white px-4 py-3 text-sm ring-1 ring-slate-200">
                    <p className="font-medium">{route.name}</p>
                    <p className="mt-1 text-slate-500">
                      {route.origin_stop_name} to {route.destination_stop_name}
                    </p>
                    <p className="mt-1 text-slate-500">
                      {route.outbound_stop_count} stops · {route.expected_duration_min} min · every{' '}
                      {route.headway_min} min
                      {route.active_trip_count > 0 ? ` · ${route.active_trip_count} running` : ''}
                    </p>
                  </li>
                ))}
            </ul>
          </section>
        </div>
      </div>
    </AppShell>
  );
}

function byDeparture(a: TripLive, b: TripLive) {
  if (a.status !== b.status) return a.status === 'in_progress' ? -1 : 1;
  return a.scheduled_start_at.localeCompare(b.scheduled_start_at);
}

function BusChoice({ trip, destination }: { trip: TripLive; destination?: string }) {
  const live = trip.status === 'in_progress';
  const delay = formatDelay(trip.delay_minutes);
  const when = live
    ? trip.next_stop_name
      ? `Next stop ${trip.next_stop_name}`
      : 'On the road'
    : `Departs ${formatClock(trip.scheduled_start_at)}`;
  const href = destination
    ? `/track/${trip.trip_id}?destination=${destination}`
    : `/track/${trip.trip_id}`;

  return (
    <Link
      className="flex items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200 transition hover:ring-slate-300"
      href={href}
    >
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: trip.route_color }}
          />
          <span className="truncate font-medium">{trip.bus_label ?? 'Bus'}</span>
        </span>
        <span className="mt-1 block truncate text-sm text-slate-500">
          {trip.route_name}
          {' · '}
          {when}
          {delay ? ` · ${delay}` : ''}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <StatusBadge state={trip.operational_state === 'GPS_UNAVAILABLE' && !live ? 'SCHEDULED' : trip.operational_state} />
        <span className="text-xs font-medium text-[#2563eb]">{live ? 'Track' : 'Details'}</span>
      </span>
    </Link>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-slate-500">{label}</span>
      {children}
    </label>
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
      className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-[#2563eb] focus:bg-white"
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
        </option>
      ))}
    </select>
  );
}

function formatClock(iso: string) {
  return new Date(iso).toLocaleTimeString('en-PK', { hour: 'numeric', minute: '2-digit' });
}
