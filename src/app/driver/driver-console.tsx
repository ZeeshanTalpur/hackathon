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
}: {
  initialTrips: TripLive[];
  linked?: boolean;
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
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Assigned trip</span>
        <select
          className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"
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
              {trip.bus_label ?? 'Bus'} · {trip.route_name}
            </option>
          ))}
        </select>
      </label>

      {selected ? (
        <>
          <section className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: selected.route_color }}
                />
                <span className="text-sm font-medium">{selected.bus_label ?? 'Bus'}</span>
              </div>
              <StatusBadge state={selected.operational_state} />
            </div>

            <p className="text-sm opacity-70">{selected.route_name}</p>

            <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <Fact label="Route" value={selected.route_name} />
              <Fact label="Progress" value={`${Number(selected.progress_pct).toFixed(0)}%`} />
              <Fact label="Next stop" value={selected.next_stop_name ?? '--'} />
              <Fact
                label="Speed"
                value={
                  selected.speed_kmh === null ? '—' : `${Number(selected.speed_kmh).toFixed(0)} km/h`
                }
              />
            </dl>

            {formatDelay(selected.delay_minutes) ? (
              <p className="text-sm text-amber-600">{formatDelay(selected.delay_minutes)}</p>
            ) : null}
          </section>

          {error ? <ErrorState title="Action failed" detail={error} /> : null}
          {notice ? (
            <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              {notice}
            </p>
          ) : null}

          <section className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-sm font-medium">Trip controls</h2>

            <div className="flex flex-wrap gap-2">
              <button
                className="flex-1 rounded-xl bg-[#2563eb] px-4 py-3 text-sm font-medium text-white disabled:opacity-40"
                disabled={busy || isActive || selected.status === 'completed'}
                onClick={() => void call({ action: 'start' })}
                type="button"
              >
                Start trip
              </button>
              <button
                className="flex-1 rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:opacity-40"
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

          <section className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-sm font-medium">Location</h2>
            <p className="text-sm text-slate-500">
              Share this phone&apos;s GPS, or simulate the route when the bus is not actually moving.
              Say that the movement is simulated during a demonstration.
            </p>

            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                className={`flex-1 rounded-xl px-4 py-3 text-sm font-medium disabled:opacity-40 ${
                  gpsMode === 'simulated'
                    ? 'bg-[#2563eb] text-white'
                    : 'bg-slate-50 text-slate-800 ring-1 ring-slate-200'
                }`}
                disabled={!isActive}
                onClick={() => setGpsMode(gpsMode === 'simulated' ? 'off' : 'simulated')}
                type="button"
              >
                {gpsMode === 'simulated' ? 'Stop simulation' : 'Simulate the route'}
              </button>
              <button
                className={`flex-1 rounded-xl px-4 py-3 text-sm font-medium disabled:opacity-40 ${
                  gpsMode === 'device'
                    ? 'bg-[#2563eb] text-white'
                    : 'bg-slate-50 text-slate-800 ring-1 ring-slate-200'
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
                {gpsMode === 'device' ? 'Stop phone GPS' : 'Share phone GPS'}
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

          <section className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-sm font-medium">Report a delay</h2>
            <div className="flex flex-wrap gap-2">
              {[0, 5, 12, 25].map((minutes) => (
                <button
                  className="flex-1 rounded-xl bg-slate-50 px-3 py-2.5 text-sm ring-1 ring-slate-200 disabled:opacity-40"
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
              className="text-sm font-medium text-[#2563eb]"
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
