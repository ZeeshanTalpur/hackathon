'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import { StatusBadge, formatDelay } from '@/components/trip-status';
import { EmptyState, ErrorState } from '@/components/app-shell';
import type { TripLive } from '@/lib/types/database';

/**
 * Simulation cadence.
 *
 * The server advances the bus by the real time since its last fix multiplied by
 * TIME_SCALE, rather than by a fixed amount per request. Browsers throttle
 * timers in background tabs, so a fixed step made the bus crawl whenever the
 * driver window lost focus; deriving it from the clock makes the pace correct
 * however irregularly this interval actually fires.
 *
 * 5x keeps a 16 km route to a few minutes - fast enough to watch, slow enough
 * to show the ETA counting down and to report a delay mid-trip.
 */
const TICK_MS = 3000;
const TIME_SCALE = 5;
const DEFAULT_SPEED_KMH = 30;

type GpsMode = 'off' | 'simulated' | 'device';

export function DriverConsole({
  initialTrips,
  linked,
}: {
  initialTrips: TripLive[];
  linked: boolean;
}) {
  const [trips, setTrips] = useState(initialTrips);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialTrips.find((t) => t.status === 'in_progress')?.trip_id
      ?? initialTrips[0]?.trip_id
      ?? null,
  );
  const [gpsMode, setGpsMode] = useState<GpsMode>('off');
  const [speed, setSpeed] = useState(DEFAULT_SPEED_KMH);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selected = trips.find((t) => t.trip_id === selectedId) ?? null;
  const isActive = selected?.status === 'in_progress';

  const applyTrip = useCallback((updated: TripLive) => {
    setTrips((current) =>
      current.map((t) => (t.trip_id === updated.trip_id ? updated : t)),
    );
  }, []);

  const call = useCallback(
    async (payload: Record<string, unknown>, { quiet = false } = {}) => {
      if (!selectedId) return null;
      if (!quiet) setBusy(true);
      try {
        const response = await fetch('/api/trip-control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tripId: selectedId, ...payload }),
        });
        const body = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(body.error ?? `Request failed (${response.status})`);
        }

        if (body.trip) applyTrip(body.trip as TripLive);
        if (!quiet) setError(null);
        return body.trip as TripLive;
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : 'Request failed');
        return null;
      } finally {
        if (!quiet) setBusy(false);
      }
    },
    [selectedId, applyTrip],
  );

  // Simulated GPS. The server computes the new position from the route geometry,
  // so every tick is deterministic and the bus stays exactly on its route.
  useEffect(() => {
    if (gpsMode !== 'simulated' || !isActive) return;

    const id = setInterval(async () => {
      const updated = await call(
        { action: 'tick', speedKmh: speed, timeScale: TIME_SCALE },
        { quiet: true },
      );
      if (updated && updated.status === 'completed') {
        setGpsMode('off');
        setNotice('Route finished - the trip completed automatically.');
      }
    }, TICK_MS);

    return () => clearInterval(id);
  }, [gpsMode, isActive, speed, call]);

  // Real browser GPS, where the device allows it. Availability is checked in
  // the click handler so this effect only subscribes to the external source.
  const watchRef = useRef<number | null>(null);
  useEffect(() => {
    if (gpsMode !== 'device' || !isActive) return;

    watchRef.current = navigator.geolocation.watchPosition(
      (position) => {
        void call(
          {
            action: 'gps',
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            speedKmh: position.coords.speed === null ? 0 : position.coords.speed * 3.6,
            headingDeg: position.coords.heading,
          },
          { quiet: true },
        );
      },
      (positionError) => {
        setError(`Device GPS unavailable: ${positionError.message}. Use simulated GPS instead.`);
        setGpsMode('off');
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );

    return () => {
      if (watchRef.current !== null) {
        navigator.geolocation.clearWatch(watchRef.current);
        watchRef.current = null;
      }
    };
  }, [gpsMode, isActive, call]);

  if (trips.length === 0) {
    return (
      <EmptyState
        title="No trips assigned"
        detail="No scheduled or active trips were found. Reload the demo data with supabase/seed.sql to restore the schedule."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {!linked ? (
        <p className="rounded border border-black/15 p-3 text-xs opacity-70 dark:border-white/15">
          This demo account is not linked to a driver record, so every trip is shown.
        </p>
      ) : null}

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Assigned trip</span>
        <select
          className="rounded border border-black/20 bg-transparent px-3 py-2.5 text-sm dark:border-white/20"
          onChange={(event) => {
            setSelectedId(event.target.value);
            setGpsMode('off');
            setError(null);
            setNotice(null);
          }}
          value={selectedId ?? ''}
        >
          {trips.map((trip) => (
            <option key={trip.trip_id} value={trip.trip_id}>
              {trip.trip_code} - {trip.route_code} - {trip.registration_no} ({trip.status})
            </option>
          ))}
        </select>
      </label>

      {selected ? (
        <>
          <section className="flex flex-col gap-3 rounded border border-black/15 p-4 dark:border-white/15">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span
                  className="rounded px-2 py-0.5 text-xs font-semibold text-white"
                  style={{ backgroundColor: selected.route_color }}
                >
                  {selected.route_code}
                </span>
                <span className="text-sm font-medium">{selected.registration_no}</span>
              </div>
              <StatusBadge state={selected.operational_state} />
            </div>

            <p className="text-sm opacity-70">{selected.route_name}</p>

            <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <Fact label="Trip" value={selected.trip_code} />
              <Fact label="Progress" value={`${Number(selected.progress_pct).toFixed(0)}%`} />
              <Fact label="Next stop" value={selected.next_stop_name ?? '--'} />
              <Fact
                label="Position"
                value={
                  selected.latitude !== null && selected.longitude !== null
                    ? `${Number(selected.latitude).toFixed(4)}, ${Number(selected.longitude).toFixed(4)}`
                    : 'No fix yet'
                }
              />
            </dl>

            {formatDelay(selected.delay_minutes) ? (
              <p className="text-sm text-amber-600">{formatDelay(selected.delay_minutes)}</p>
            ) : null}
          </section>

          {error ? <ErrorState title="Action failed" detail={error} /> : null}
          {notice ? (
            <p className="rounded border border-black/15 p-3 text-sm dark:border-white/15">
              {notice}
            </p>
          ) : null}

          <section className="flex flex-col gap-3 rounded border border-black/15 p-4 dark:border-white/15">
            <h2 className="text-sm font-medium">Trip controls</h2>

            <div className="flex flex-wrap gap-2">
              <button
                className="flex-1 rounded bg-green-600 px-4 py-3 text-sm font-medium text-white disabled:opacity-40"
                disabled={busy || isActive || selected.status === 'completed'}
                onClick={() => void call({ action: 'start' })}
                type="button"
              >
                Start trip
              </button>
              <button
                className="flex-1 rounded bg-red-600 px-4 py-3 text-sm font-medium text-white disabled:opacity-40"
                disabled={busy || !isActive}
                onClick={() => {
                  setGpsMode('off');
                  void call({ action: 'end' });
                }}
                type="button"
              >
                End trip
              </button>
            </div>

            {selected.status === 'completed' ? (
              <p className="text-xs opacity-70">
                This trip is completed. Reload the demo data to run it again.
              </p>
            ) : null}
          </section>

          <section className="flex flex-col gap-3 rounded border border-black/15 p-4 dark:border-white/15">
            <h2 className="text-sm font-medium">GPS</h2>

            <div className="flex flex-wrap gap-2">
              <button
                className={`flex-1 rounded px-4 py-3 text-sm font-medium disabled:opacity-40 ${
                  gpsMode === 'simulated'
                    ? 'bg-foreground text-background'
                    : 'border border-black/20 dark:border-white/20'
                }`}
                disabled={!isActive}
                onClick={() => setGpsMode(gpsMode === 'simulated' ? 'off' : 'simulated')}
                type="button"
              >
                {gpsMode === 'simulated' ? 'Stop simulation' : 'Start simulated GPS'}
              </button>
              <button
                className={`flex-1 rounded px-4 py-3 text-sm font-medium disabled:opacity-40 ${
                  gpsMode === 'device'
                    ? 'bg-foreground text-background'
                    : 'border border-black/20 dark:border-white/20'
                }`}
                disabled={!isActive}
                onClick={() => {
                  if (gpsMode === 'device') {
                    setGpsMode('off');
                    return;
                  }
                  if (!navigator.geolocation) {
                    setError('This browser does not expose geolocation. Use simulated GPS instead.');
                    return;
                  }
                  setError(null);
                  setGpsMode('device');
                }}
                type="button"
              >
                {gpsMode === 'device' ? 'Stop device GPS' : 'Use device GPS'}
              </button>
            </div>

            <label className="flex flex-col gap-1 text-xs">
              <span className="opacity-70">Simulated speed: {speed} km/h</span>
              <input
                className="w-full"
                disabled={gpsMode === 'device'}
                max={60}
                min={0}
                onChange={(event) => setSpeed(Number(event.target.value))}
                step={5}
                type="range"
                value={speed}
              />
              <span className="opacity-60">
                Set 0 km/h to report the bus as stopped without ending the trip.
              </span>
            </label>

            {!isActive ? (
              <p className="text-xs opacity-70">Start the trip before sending GPS updates.</p>
            ) : null}
          </section>

          <section className="flex flex-col gap-3 rounded border border-black/15 p-4 dark:border-white/15">
            <h2 className="text-sm font-medium">Report a delay</h2>
            <div className="flex flex-wrap gap-2">
              {[0, 5, 12, 25].map((minutes) => (
                <button
                  className="flex-1 rounded border border-black/20 px-3 py-2.5 text-sm disabled:opacity-40 dark:border-white/20"
                  disabled={busy || selected.status === 'completed'}
                  key={minutes}
                  onClick={() => void call({ action: 'delay', delayMinutes: minutes })}
                  type="button"
                >
                  {minutes === 0 ? 'Clear' : `${minutes} min`}
                </button>
              ))}
            </div>
            <p className="text-xs opacity-60">
              5 minutes or more marks the trip as delayed for passengers and the operator.
            </p>
          </section>

          {isActive ? (
            <Link
              className="text-sm underline"
              href={`/track/${selected.trip_id}`}
              target="_blank"
            >
              Open the passenger view for this trip
            </Link>
          ) : null}
        </>
      ) : null}
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
