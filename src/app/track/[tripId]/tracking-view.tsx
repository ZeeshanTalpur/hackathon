'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { TransitMap } from '@/components/transit-map';
import { StatusBadge, formatDelay, formatEta } from '@/components/trip-status';
import { ErrorState } from '@/components/states';
import { createClient } from '@/lib/supabase/client';
import type { OperationalState, RoutePathStop, TripLive, TripStopEta } from '@/lib/types/database';

/** A fix older than this is not shown as a live position. Matches v_trip_live. */
const STALE_AFTER_MS = 3 * 60 * 1000;

type ConnectionState = 'connecting' | 'live' | 'polling' | 'error';

interface TrackingViewProps {
  initialTrip: TripLive;
  initialEtas: TripStopEta[];
  path: RoutePathStop[];
  boardingStopId: string | null;
  destinationStopId: string | null;
}

export function TrackingView({
  initialTrip,
  initialEtas,
  path,
  boardingStopId,
  destinationStopId,
}: TrackingViewProps) {
  const [trip, setTrip] = useState(initialTrip);
  const [etas, setEtas] = useState(initialEtas);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [fetchError, setFetchError] = useState<string | null>(null);
  // Re-renders on a timer so a fix that goes stale is detected even when no
  // further events arrive - silence is exactly the case we must catch.
  // Null until after hydration. A server timestamp and the browser clock disagree,
  // and that disagreement was showing up as a different "minutes ago".
  const [now, setNow] = useState<number | null>(null);

  const tripId = initialTrip.trip_id;
  const busId = initialTrip.bus_id;
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const response = await fetch(`/api/trip-control?tripId=${tripId}`, { cache: 'no-store' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${response.status})`);
      }
      const body = (await response.json()) as { trip: TripLive; etas: TripStopEta[] };
      setTrip(body.trip);
      setEtas(body.etas);
      setFetchError(null);
    } catch (error) {
      setFetchError(error instanceof Error ? error.message : 'Could not refresh trip');
    } finally {
      inFlight.current = false;
    }
  }, [tripId]);

  // Realtime: the driver's write lands in Postgres, Supabase broadcasts it, we
  // refetch the derived state (ETA and next stop are computed in SQL).
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`trip-${tripId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'bus_locations', filter: `bus_id=eq.${busId}` },
        () => void refresh(),
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'trips', filter: `id=eq.${tripId}` },
        () => void refresh(),
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setConnection('live');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setConnection('polling');
        else if (status === 'CLOSED') setConnection('error');
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [tripId, busId, refresh]);

  // Only poll when realtime is not carrying updates.
  useEffect(() => {
    if (connection === 'live') return;
    const id = setInterval(() => void refresh(), 5000);
    return () => clearInterval(id);
  }, [connection, refresh]);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, []);

  const fixAt = trip.location_recorded_at ? new Date(trip.location_recorded_at).getTime() : null;
  const fixAgeMs = fixAt === null || now === null ? null : Math.max(now - fixAt, 0);
  const isStale = now !== null && (fixAgeMs === null || fixAgeMs > STALE_AFTER_MS);
  const isFinished = trip.status === 'completed' || trip.status === 'cancelled';

  // Client-side staleness wins over the server snapshot: the row was accurate
  // when fetched, but time has passed since.
  const state: OperationalState =
    now === null || isFinished
      ? trip.operational_state
      : isStale
        ? 'GPS_UNAVAILABLE'
        : trip.operational_state;

  const hasLivePosition =
    state !== 'GPS_UNAVAILABLE' &&
    !isFinished &&
    trip.latitude !== null &&
    trip.longitude !== null;
  const upcoming = etas.filter((e) => e.stop_order > (trip.last_stop_order ?? 0));
  const boardingEta = boardingStopId ? upcoming.find((e) => e.stop_id === boardingStopId) : undefined;
  const destinationEta = destinationStopId
    ? upcoming.find((e) => e.stop_id === destinationStopId)
    : undefined;
  const nextEta = upcoming[0];
  const headlineEta = boardingEta ?? destinationEta ?? nextEta;
  const delay = formatDelay(trip.delay_minutes);
  const quiet = now !== null && state === 'GPS_UNAVAILABLE';
  const stopTips = useMemo(() => {
    const etaByStop = new Map(etas.map((stop) => [stop.stop_id, stop.eta_minutes]));
    const passedThrough = trip.last_stop_order ?? 0;
    return path.map((stop) => ({
      stopId: stop.stop_id,
      label:
        stop.stop_order <= passedThrough
          ? 'Passed'
          : quiet
            ? 'No live location'
            : etaByStop.has(stop.stop_id)
              ? formatEta(etaByStop.get(stop.stop_id))
              : 'Later',
    }));
  }, [etas, path, quiet, trip.last_stop_order]);

  return (
    <div className="absolute inset-0">
      <TransitMap
        fill
        bus={
          trip.latitude !== null && trip.longitude !== null
            ? {
                latitude: Number(trip.latitude),
                longitude: Number(trip.longitude),
                headingDeg: trip.heading_deg === null ? null : Number(trip.heading_deg),
                label: trip.bus_label ?? 'Bus',
                isLive: hasLivePosition,
              }
            : null
        }
        destinationStopId={destinationStopId}
        nextStopId={trip.next_stop_id}
        originStopId={boardingStopId}
        path={path}
        routeColor={trip.route_color}
        stopTips={stopTips}
      />

      <section className="absolute top-4 left-4 z-10 max-h-[calc(100%-7rem)] w-[min(100%-2rem,22rem)] overflow-auto rounded-3xl bg-[#0e1424]/95 p-5 text-white shadow-2xl ring-1 ring-white/10 backdrop-blur lg:max-h-[calc(100%-2rem)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-slate-400">{trip.bus_label ?? 'Bus'}</p>
            <h2 className="text-base font-semibold leading-snug">{trip.route_name}</h2>
          </div>
          <StatusBadge state={state} light />
        </div>

        {trip.status === 'scheduled' ? (
          <p className="mt-4 text-2xl font-semibold">
            {new Date(trip.scheduled_start_at).toLocaleTimeString('en-PK', {
              hour: 'numeric',
              minute: '2-digit',
            })}
            <span className="mt-1 block text-sm font-normal text-slate-300">Has not left yet</span>
          </p>
        ) : isFinished ? (
          <p className="mt-4 text-sm text-slate-200">This bus has finished its run.</p>
        ) : state === 'GPS_UNAVAILABLE' ? (
          <p className="mt-4 text-sm text-amber-200">
            {fixAgeMs === null
              ? 'Location temporarily unavailable.'
              : `Location temporarily unavailable. Last report ${formatAge(fixAgeMs)} ago.`}
          </p>
        ) : (
          <div className="mt-4">
            <p className="font-display text-5xl leading-none tracking-tight">
              {formatEta(headlineEta?.eta_minutes)}
            </p>
            <p className="mt-1 text-sm text-slate-300">
              {headlineEta ? headlineEta.stop_name : 'Final stop'}
            </p>
            {boardingEta && destinationEta ? (
              <p className="mt-2 text-sm text-slate-300">
                Then {destinationEta.stop_name} · {formatEta(destinationEta.eta_minutes)}
              </p>
            ) : null}
            {delay ? <p className="mt-2 text-sm text-amber-300">{delay}</p> : null}
          </div>
        )}

        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-white/10 pt-3 text-sm">
          <div>
            <dt className="text-xs text-slate-400">Next stop</dt>
            <dd>{trip.next_stop_name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-400">Speed</dt>
            <dd>{hasLivePosition ? `${Number(trip.speed_kmh ?? 0).toFixed(0)} km/h` : '—'}</dd>
          </div>
        </dl>
        <ConnectionNote connection={connection} fetchError={fetchError} />
      </section>

      <aside className="absolute top-4 right-4 z-10 hidden max-h-[calc(100%-2rem)] w-80 overflow-auto rounded-3xl bg-white/95 shadow-2xl ring-1 ring-black/5 backdrop-blur lg:block">
        <p className="border-b border-black/5 px-5 py-4 text-sm font-semibold">Stops ahead</p>
        {upcoming.length === 0 ? (
          <p className="px-4 py-3 text-sm text-slate-500">
            {isFinished ? 'The run is finished.' : 'Approaching the last stop.'}
          </p>
        ) : (
          <ol>
            {upcoming.map((stop) => (
              <li
                key={stop.stop_id}
                className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5 text-sm last:border-0"
              >
                <span className={stop.stop_id === trip.next_stop_id ? 'font-medium' : 'text-slate-600'}>
                  {stop.stop_name}
                </span>
                <span className="shrink-0 text-slate-500">
                  {state === 'GPS_UNAVAILABLE' ? '—' : formatEta(stop.eta_minutes)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </aside>

      <ol className="absolute right-3 bottom-10 left-3 z-10 max-h-32 overflow-auto rounded-xl bg-white shadow-xl ring-1 ring-slate-200 lg:hidden">
        {upcoming.slice(0, 4).map((stop) => (
          <li key={stop.stop_id} className="flex justify-between gap-3 px-3 py-1.5 text-sm">
            <span>{stop.stop_name}</span>
            <span className="text-slate-500">
              {state === 'GPS_UNAVAILABLE' ? '—' : formatEta(stop.eta_minutes)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ConnectionNote({
  connection,
  fetchError,
}: {
  connection: ConnectionState;
  fetchError: string | null;
}) {
  if (fetchError) {
    return <ErrorState title="Could not refresh" detail={fetchError} />;
  }

  const text: Record<ConnectionState, string> = {
    connecting: 'Connecting',
    live: 'Live',
    polling: 'Updating',
    error: 'Reconnecting',
  };

  return (
    <p className="mt-3 text-xs text-slate-400">
      <span
        className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${
          connection === 'live' ? 'bg-emerald-400' : 'bg-amber-300'
        }`}
      />
      {text[connection]}
    </p>
  );
}

function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'less than a minute';
  if (minutes === 1) return '1 minute';
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? '1 hour' : `${hours} hours`;
}
