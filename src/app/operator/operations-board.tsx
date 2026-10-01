'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';

import { StatusBadge, formatDelay } from '@/components/trip-status';
import type { TripLive } from '@/lib/types/database';

interface OperationsBoardProps {
  trips: TripLive[];
  drivers: { id: string; full_name: string }[];
  routes: { id: string; name: string }[];
}

export function OperationsBoard({ trips, drivers, routes }: OperationsBoardProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');

  async function run(payload: Record<string, string>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'Update failed');
      setNotice('Saved.');
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="text-sm text-[#2563eb]">{notice}</p> : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Assign buses</h2>
        <ul className="flex flex-col gap-3">
          {trips.map((trip) => (
            <li key={trip.trip_id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">
                  {trip.bus_label ?? 'Bus'}
                  <span className="font-normal text-slate-500"> · {trip.route_name}</span>
                </p>
                <StatusBadge state={trip.operational_state} />
              </div>
              <p className="mt-1 text-sm text-slate-500">
                {trip.status === 'scheduled' ? 'Not departed' : 'On the road'}
                {trip.next_stop_name ? ` · next ${trip.next_stop_name}` : ''}
                {formatDelay(trip.delay_minutes) ? ` · ${formatDelay(trip.delay_minutes)}` : ''}
              </p>

              <form
                className="mt-3 flex flex-col gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  void run({
                    action: 'assign_driver',
                    tripId: trip.trip_id,
                    driverId: String(data.get('driverId') ?? ''),
                  });
                }}
              >
                <label className="text-xs text-slate-500">
                  Driver
                  <select
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-[white] px-3 py-2 text-sm text-slate-900"
                    defaultValue={trip.driver_id ?? ''}
                    name="driverId"
                  >
                    <option value="" disabled>
                      Choose a driver
                    </option>
                    {drivers.map((driver) => (
                      <option key={driver.id} value={driver.id}>
                        {driver.full_name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="rounded-xl bg-[#2563eb] px-3 py-2 text-sm text-white disabled:opacity-50"
                  disabled={busy}
                  type="submit"
                >
                  Assign driver
                </button>
              </form>

              {trip.status === 'scheduled' ? (
                <form
                  className="mt-3 flex flex-col gap-2 border-t border-slate-100 pt-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    void run({
                      action: 'assign_route',
                      tripId: trip.trip_id,
                      routeId: String(data.get('routeId') ?? ''),
                    });
                  }}
                >
                  <label className="text-xs text-slate-500">
                    Route
                    <select
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-[white] px-3 py-2 text-sm text-slate-900"
                      defaultValue={trip.route_id}
                      name="routeId"
                    >
                      {routes.map((route) => (
                        <option key={route.id} value={route.id}>
                          {route.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-slate-300 disabled:opacity-50"
                    disabled={busy}
                    type="submit"
                  >
                    Change route
                  </button>
                </form>
              ) : (
                <p className="mt-3 text-xs text-slate-400">
                  Route stays fixed once the bus has left.
                </p>
              )}

              <Link className="mt-3 inline-block text-sm text-[#2563eb]" href={`/track/${trip.trip_id}`}>
                Watch this bus
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-sm font-medium">Announcement</h2>
        <p className="mt-1 text-sm text-slate-500">Passengers on the network can read this.</p>
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run({ action: 'announce', title, message });
            setTitle('');
            setMessage('');
          }}
        >
          <input
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Title"
            value={title}
          />
          <textarea
            className="min-h-20 rounded-xl border border-slate-200 px-3 py-2 text-sm"
            onChange={(event) => setMessage(event.target.value)}
            placeholder="What should riders know?"
            value={message}
          />
          <button
            className="rounded-xl bg-[#2563eb] px-3 py-2 text-sm text-white disabled:opacity-50"
            disabled={busy}
            type="submit"
          >
            Publish
          </button>
        </form>
      </section>
    </div>
  );
}
