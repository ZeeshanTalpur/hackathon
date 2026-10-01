'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

const BUS_STATUS = [
  { value: 'active', label: 'On route' },
  { value: 'idle', label: 'Available' },
  { value: 'maintenance', label: 'Break' },
  { value: 'offline', label: 'Offline' },
] as const;

export function FleetTools({
  buses,
  routes,
}: {
  buses: { id: string; label: string | null; status: string; capacity: number }[];
  routes: { route_id: string; name: string; is_active: boolean }[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function save(payload: Record<string, string>) {
    setError(null);
    const response = await fetch('/api/operations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(body.error ?? 'Could not save');
      return;
    }
    router.refresh();
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Buses</h2>
        <ul className="flex flex-col gap-2">
          {buses.map((bus) => (
            <li key={bus.id} className="rounded-2xl bg-white p-3 text-sm ring-1 ring-slate-200">
              <p className="font-medium">{bus.label ?? 'Bus'}</p>
              <p className="text-slate-500">{bus.capacity} seats</p>
              <select
                className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2"
                defaultValue={bus.status}
                onChange={(event) =>
                  void save({ action: 'set_bus_status', busId: bus.id, status: event.target.value })
                }
              >
                {BUS_STATUS.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Routes</h2>
        <ul className="flex flex-col gap-2">
          {routes.map((route) => (
            <li
              key={route.route_id}
              className="flex items-center justify-between gap-3 rounded-2xl bg-white p-3 text-sm ring-1 ring-slate-200"
            >
              <span className="min-w-0">{route.name}</span>
              <button
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${
                  route.is_active ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-500'
                }`}
                onClick={() =>
                  void save({
                    action: 'set_route_active',
                    routeId: route.route_id,
                    active: route.is_active ? 'false' : 'true',
                  })
                }
                type="button"
              >
                {route.is_active ? 'Running' : 'Paused'}
              </button>
            </li>
          ))}
        </ul>
      </section>
      {error ? <p className="text-sm text-red-700 lg:col-span-2">{error}</p> : null}
    </div>
  );
}
