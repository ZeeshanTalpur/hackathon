import Link from 'next/link';
import type { ReactNode } from 'react';

import { StatusBadge, formatDelay, formatEta } from '@/components/trip-status';
import { AppShell, ErrorState } from '@/components/app-shell';
import {
  SUPABASE_CONFIGURED,
  arrivalsAtStop,
  busesApproaching,
  listStops,
  operatorTrips,
  scheduleBoard,
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
  let schedules: Awaited<ReturnType<typeof scheduleBoard>> = [];
  let running: TripLive[] = [];
  let arrivals: StopArrival[] = [];
  let loadError: string | null = null;
  try {
    [stops, schedules, running] = await Promise.all([listStops(), scheduleBoard(), operatorTrips()]);
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
  const originName = stops.find((item) => item.id === origin)?.name;
  const destinationName = stops.find((item) => item.id === destination)?.name;

  let buses: { trip: TripLive; etaMinutes: number | null; approaching: boolean }[] = [];
  let heading = 'Choose a bus';
  let note: string | null = null;
  let searchError: string | null = null;

  if (searched && !sameStop) {
    try {
      const ride = await busesApproaching(origin!, destination!);
      if (ride.buses.length > 0) {
        buses = ride.buses.map((bus) => ({ ...bus, approaching: true }));
        heading = `Approaching ${originName ?? 'your stop'}`;
        note = `These buses have not reached ${originName ?? 'your stop'} yet, and they continue to ${destinationName ?? 'your destination'}. The time is until they arrive at ${originName ?? 'your stop'}.`;
      } else {
        heading = `Approaching ${originName ?? 'your stop'}`;
        note = ride.matchedRoute
          ? `No bus is still on its way to ${originName ?? 'your stop'} before continuing to ${destinationName ?? 'your destination'}. Buses already past that stop are not listed.`
          : `No running bus connects ${originName ?? 'those stops'} and then continues to ${destinationName ?? 'the destination'}.`;
      }
    } catch (error) {
      searchError = error instanceof Error ? error.message : 'Search failed.';
    }
  }

  return (
    <AppShell title="Find a bus">
      <div className="grid items-start gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="flex flex-col gap-4 lg:sticky lg:top-6">
          <form className="flex flex-col gap-4 rounded-3xl bg-white p-5 shadow-[0_20px_50px_-30px_rgba(14,20,36,0.45)] ring-1 ring-black/5">
            <div>
              <p className="text-[11px] font-semibold tracking-[0.22em] text-[#9a7b3c] uppercase">Plan a ride</p>
              <p className="font-display mt-1 text-2xl leading-none">Where to?</p>
              <p className="mt-2 text-sm leading-5 text-slate-500">
                Buses still coming toward From, then continuing to To.
              </p>
            </div>
            <Field label="From">
              <StopSelect name="origin" stops={stops} value={origin} />
            </Field>
            <Field label="To">
              <StopSelect name="destination" stops={stops} value={destination} />
            </Field>
            <button
              className="rounded-2xl bg-[#0e1424] px-4 py-3.5 text-sm font-medium text-white transition hover:bg-[#1b2436]"
              type="submit"
            >
              Show buses
            </button>
            {sameStop ? <p className="text-sm text-slate-500">Choose two different stops.</p> : null}
          </form>

          <section className="flex flex-col gap-3 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
            <h2 className="text-sm font-semibold">At a stop</h2>
            <p className="text-sm leading-5 text-slate-500">How long until the next buses reach this stop.</p>
            <form className="flex flex-col gap-2">
              <select
                className="min-w-0 rounded-2xl border border-black/10 bg-[#f7f4ee] px-3 py-2.5 text-sm outline-none focus:border-[#c4a265] focus:bg-white"
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
              <button className="rounded-2xl bg-[#c4a265] px-4 py-2.5 text-sm font-semibold text-[#0e1424]" type="submit">
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
                    className="flex items-center justify-between gap-3 rounded-2xl bg-[#f7f4ee] px-3 py-2.5"
                    href={`/track/${arrival.trip_id}?destination=${stop}`}
                  >
                    <span>
                      <span className="block text-sm font-medium">{arrival.route_name}</span>
                      <span className="text-sm text-slate-500">
                        {formatEta(arrival.eta_minutes)}
                        {Number(arrival.projected_delay_minutes) >= 5 ? ' · Delayed' : ''}
                      </span>
                    </span>
                    <span className="text-sm font-semibold text-[#0e1424]">Track</span>
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
                <h2 className="font-display text-3xl leading-none">{heading}</h2>
                {note ? (
                  <p className="mt-2 text-sm text-slate-500">{note}</p>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">
                    {buses.length === 1 ? '1 bus' : `${buses.length} buses`}. Choose one to follow it on the map.
                  </p>
                )}
              </div>
              <ul className="flex flex-col gap-3">
                {buses.map((bus) => (
                  <li key={bus.trip.trip_id}>
                    <BusChoice
                      approaching={bus.approaching}
                      boardingName={originName}
                      destination={destination}
                      destinationName={destinationName}
                      etaMinutes={bus.etaMinutes}
                      origin={origin}
                      trip={bus.trip}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <section className="relative overflow-hidden rounded-3xl bg-[#0e1424] p-7 text-white shadow-[0_30px_60px_-36px_rgba(14,20,36,0.8)] sm:p-9">
              <div className="pointer-events-none absolute -top-16 -right-10 h-48 w-48 rounded-full bg-[#c4a265]/30 blur-3xl" />
              <p className="text-[11px] font-semibold tracking-[0.22em] text-[#c4a265] uppercase">Live network</p>
              <h2 className="font-display mt-3 max-w-lg text-4xl leading-[1.05] sm:text-5xl">
                See the bus before you step outside.
              </h2>
              <p className="mt-4 max-w-md text-sm leading-6 text-white/65">
                Pick two stops. You will see buses that are still on their way to the first one, then open the one you want on a live map.
              </p>
              <dl className="mt-8 flex gap-8">
                <div>
                  <dt className="text-[11px] tracking-wide text-white/45 uppercase">On the road</dt>
                  <dd className="font-display text-3xl">{running.filter((trip) => trip.status === 'in_progress').length}</dd>
                </div>
                <div>
                  <dt className="text-[11px] tracking-wide text-white/45 uppercase">Routes</dt>
                  <dd className="font-display text-3xl">{schedules.filter((route) => route.is_active).length}</dd>
                </div>
              </dl>
            </section>
          )}

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">Schedules</h2>
            <ul className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {schedules
                .filter((route) => route.is_active)
                .map((route) => (
                  <li key={route.route_id} className="rounded-3xl bg-white px-4 py-4 text-sm shadow-sm ring-1 ring-black/5">
                    <p className="font-medium">{route.name}</p>
                    <p className="mt-1 text-slate-500">
                      {route.origin_stop_name} to {route.destination_stop_name}
                    </p>
                    <p className="mt-3 text-xs tracking-wide text-slate-400 uppercase">
                      {route.outbound_stop_count} stops · {route.expected_duration_min} min · every {route.headway_min} min
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
function BusChoice({
  trip,
  origin,
  destination,
  boardingName,
  destinationName,
  etaMinutes,
  approaching,
}: {
  trip: TripLive;
  origin?: string;
  destination?: string;
  boardingName?: string;
  destinationName?: string;
  etaMinutes: number | null;
  approaching: boolean;
}) {
  const live = trip.status === 'in_progress';
  const delay = formatDelay(trip.delay_minutes);
  const when = approaching
    ? etaMinutes === null
      ? `On the way to ${boardingName ?? 'your stop'}`
      : `${formatEta(etaMinutes)} at ${boardingName ?? 'your stop'}`
    : live
      ? trip.next_stop_name
        ? `Next stop ${trip.next_stop_name}`
        : 'On the road'
      : `Departs ${formatClock(trip.scheduled_start_at)}`;
  const params = new URLSearchParams();
  if (origin) params.set('boarding', origin);
  if (destination) params.set('destination', destination);
  const query = params.toString();
  const href = query ? `/track/${trip.trip_id}?${query}` : `/track/${trip.trip_id}`;

  return (
    <Link
      className="group flex items-center justify-between gap-4 rounded-3xl bg-white px-4 py-4 shadow-sm ring-1 ring-black/5 transition hover:-translate-y-0.5 hover:shadow-md"
      href={href}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="h-12 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: trip.route_color }} />
        <span className="min-w-0">
          <span className="block truncate text-base font-semibold">{trip.bus_label ?? 'Bus'}</span>
          <span className="mt-1 block truncate text-sm text-slate-500">
            {trip.route_name}
            {' · '}
            {when}
            {delay ? ` · ${delay}` : ''}
          </span>
          {approaching && destinationName ? (
            <span className="mt-0.5 block truncate text-sm text-slate-500">Continues to {destinationName}</span>
          ) : null}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <StatusBadge state={trip.operational_state === 'GPS_UNAVAILABLE' && !live ? 'SCHEDULED' : trip.operational_state} />
        <span className="rounded-full bg-[#0e1424] px-3 py-1 text-[11px] font-semibold tracking-wide text-white uppercase">
          {live ? 'Track' : 'Details'}
        </span>
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
      className="rounded-2xl border border-black/10 bg-[#f7f4ee] px-3 py-3 text-sm outline-none focus:border-[#c4a265] focus:bg-white"
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
