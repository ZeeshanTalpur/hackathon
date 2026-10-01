'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { TransitMap } from '@/components/transit-map';
import { StatusBadge, formatDelay, formatEta } from '@/components/trip-status';
import { EmptyState, ErrorState } from '@/components/app-shell';
import { createClient } from '@/lib/supabase/client';
import type { OperationalState, RoutePathStop, TripLive, TripStopEta } from '@/lib/types/database';

/** A fix older than this is not shown as a live position. Matches v_trip_live. */
const STALE_AFTER_MS = 3 * 60 * 1000;

type ConnectionState = 'connecting' | 'live' | 'polling' | 'error';

interface TrackingViewProps {
  initialTrip: TripLive;
  initialEtas: TripStopEta[];
  path: RoutePathStop[];
  destinationStopId: string | null;
}

export function TrackingView({
  initialTrip,
  initialEtas,
  path,
  destinationStopId,
}: TrackingViewProps) {
  const [trip, setTrip] = useState(initialTrip);
  const [etas, setEtas] = useState(initialEtas);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [fetchError, setFetchError] = useState<string | null>(null);
  // Re-renders on a timer so a fix that goes stale is detected even when no
  // further events arrive - silence is exactly the case we must catch.
  const [now, setNow] = useState(() => Date.now());

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
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  const fixAt = trip.location_recorded_at ? new Date(trip.location_recorded_at).getTime() : null;
  const fixAgeMs = fixAt === null ? null : Math.max(now - fixAt, 0);
  const isStale = fixAgeMs === null || fixAgeMs > STALE_AFTER_MS;
  const isFinished = trip.status === 'completed' || trip.status === 'cancelled';

  // Client-side staleness wins over the server snapshot: the row was accurate
  // when fetched, but time has passed since.
  const state: OperationalState = isFinished
    ? trip.operational_state
    : isStale
      ? 'GPS_UNAVAILABLE'
      : trip.operational_state;

  const hasLivePosition = !isStale && trip.latitude !== null && trip.longitude !== null;
  const upcoming = etas.filter((e) => e.stop_order > (trip.last_stop_order ?? 0));
  const destinationEta = destinationStopId
    ? upcoming.find((e) => e.stop_id === destinationStopId)
    : undefined;
  const nextEta = upcoming[0];
  const delay = formatDelay(trip.delay_minutes);

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-3 rounded border border-black/15 p-4 dark:border-white/15">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className="rounded px-2 py-0.5 text-xs font-semibold text-white"
              style={{ backgroundColor: trip.route_color }}
            >
              {trip.route_code}
            </span>
            <span className="text-sm font-medium">{trip.registration_no}</span>
          </div>
          <StatusBadge state={state} />
        </div>

        <p className="text-sm opacity-70">{trip.route_name}</p>

        {/* Headline ETA: destination if the passenger picked one, else next stop. */}
        {isFinished ? (
          <p className="text-sm font-medium">
            This trip has {trip.status === 'completed' ? 'completed' : 'been cancelled'}. It is no
            longer being tracked live.
          </p>
        ) : state === 'GPS_UNAVAILABLE' ? (
          <div className="rounded border border-amber-500/50 bg-amber-500/5 p-3 text-sm">
            <p className="font-medium">Location temporarily unavailable</p>
            <p className="opacity-70">
              {fixAt === null
                ? 'This bus has not reported a position yet.'
                : `Last report ${formatAge(fixAgeMs!)} ago. ETA is held until a fresh position arrives.`}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <p className="text-2xl font-semibold">
              {formatEta(destinationEta?.eta_minutes ?? nextEta?.eta_minutes)}
            </p>
            <p className="text-xs opacity-70">
              {destinationEta
                ? `to ${destinationEta.stop_name} (your destination)`
                : nextEta
                  ? `to ${nextEta.stop_name} (next stop)`
                  : 'at the final stop'}
            </p>
            {delay ? <p className="text-sm text-amber-600">{delay}</p> : null}
          </div>
        )}

        <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <Fact label="Next stop" value={trip.next_stop_name ?? '--'} />
          <Fact label="Progress" value={`${Number(trip.progress_pct).toFixed(0)}%`} />
          <Fact
            label="Speed"
            value={hasLivePosition ? `${Number(trip.speed_kmh ?? 0).toFixed(0)} km/h` : '--'}
          />
          <Fact label="Fare" value={`PKR ${trip.fare_pkr}`} />
        </dl>

        <ConnectionNote connection={connection} fetchError={fetchError} />
      </section>

      <TransitMap
        bus={
          trip.latitude !== null && trip.longitude !== null
            ? {
                latitude: Number(trip.latitude),
                longitude: Number(trip.longitude),
                headingDeg: trip.heading_deg === null ? null : Number(trip.heading_deg),
                label: `${trip.registration_no} (${trip.route_code})`,
                isLive: hasLivePosition,
              }
            : null
        }
        destinationStopId={destinationStopId}
        nextStopId={trip.next_stop_id}
        path={path}
        routeColor={trip.route_color}
      />

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Upcoming stops</h2>
        {upcoming.length === 0 ? (
          <EmptyState
            title="No upcoming stops"
            detail={
              isFinished
                ? 'The trip has finished its route.'
                : 'The bus is approaching the final stop.'
            }
          />
        ) : (
          <ol className="flex flex-col divide-y divide-black/10 rounded border border-black/15 dark:divide-white/10 dark:border-white/15">
            {upcoming.map((stop) => (
              <li
                key={stop.stop_id}
                className="flex items-center justify-between gap-3 p-3 text-sm"
              >
                <div className="flex flex-col">
                  <span className={stop.stop_id === trip.next_stop_id ? 'font-medium' : ''}>
                    {stop.stop_order}. {stop.stop_name}
                  </span>
                  <span className="text-xs opacity-60">
                    {Number(stop.remaining_km).toFixed(1)} km away
                    {Number(stop.projected_delay_minutes) >= 1
                      ? ` - ${Math.round(Number(stop.projected_delay_minutes))} min behind schedule`
                      : ''}
                  </span>
                </div>
                <span className="shrink-0 text-sm font-medium">
                  {state === 'GPS_UNAVAILABLE' ? '--' : formatEta(stop.eta_minutes)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <p className="text-xs opacity-60">
        ETA is a deterministic projection from remaining distance, reported speed and recorded
        delay. It is not a prediction and makes no accuracy claim. DEMO / SIMULATED HACKATHON DATA.
      </p>
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
    connecting: 'Connecting to live updates...',
    live: 'Live updates connected',
    polling: 'Realtime unavailable - refreshing every 5 seconds instead',
    error: 'Realtime disconnected - refreshing every 5 seconds instead',
  };

  return (
    <p className="text-xs opacity-60">
      <span
        className={`mr-1.5 inline-block h-2 w-2 rounded-full ${
          connection === 'live' ? 'bg-green-500' : 'bg-amber-500'
        }`}
      />
      {text[connection]}
    </p>
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

function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'less than a minute';
  if (minutes === 1) return '1 minute';
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? '1 hour' : `${hours} hours`;
}
