import { AppShell, EmptyState, ErrorState } from '@/components/app-shell';
import { requireRole } from '@/lib/auth';
import {
  SUPABASE_CONFIGURED,
  activeAlerts,
  fleetOverview,
  listActiveRoutes,
  listBuses,
  listDrivers,
  operatorTrips,
  scheduleBoard,
  tripAnalytics,
} from '@/lib/data/transit';
import type { FleetOverview, TripLive } from '@/lib/types/database';

import { FleetTools } from './fleet-tools';
import { OperationsBoard } from './operations-board';

export const dynamic = 'force-dynamic';

/**
 * Transport desk: fleet totals, who is late, and service announcements.
 * This is not the passenger search.
 */
export default async function OperatorPage() {
  if (!SUPABASE_CONFIGURED) {
    return (
      <AppShell title="Operations">
        <ErrorState title="Service unavailable" />
      </AppShell>
    );
  }

  const session = await requireRole(['operator', 'admin']);

  let trips: TripLive[] = [];
  let overview: FleetOverview | null = null;
  let alerts: { id: string; title: string; message: string; severity: string }[] = [];
  let drivers: { id: string; full_name: string }[] = [];
  let routes: { id: string; name: string }[] = [];
  let buses: { id: string; label: string | null; status: string; capacity: number }[] = [];
  let catalogue: Awaited<ReturnType<typeof scheduleBoard>> = [];
  let analytics = { completed: 0, averageDuration: 0 };
  let loadError: string | null = null;

  try {
    [trips, overview, alerts, drivers, routes, buses, catalogue, analytics] = await Promise.all([
      operatorTrips(),
      fleetOverview(),
      activeAlerts(),
      listDrivers(),
      listActiveRoutes(),
      listBuses(),
      scheduleBoard(),
      tripAnalytics(),
    ]);
  } catch (error) {
    loadError = error instanceof Error ? error.message : 'Could not load operations.';
  }

  if (loadError || !overview) {
    return (
      <AppShell title="Operations">
        <ErrorState title="Could not load the fleet" detail={loadError ?? undefined} />
      </AppShell>
    );
  }

  return (
    <AppShell title="Operations">
      <div className="flex items-center justify-between text-sm text-slate-500">
        <p>{session.profile?.full_name ?? 'Operator'}</p>
        <form action="/auth/sign-out" method="post">
          <button className="underline" type="submit">
            Sign out
          </button>
        </form>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Buses" value={overview.total_buses} />
        <Kpi label="On the road" value={overview.trips_in_progress} />
        <Kpi label="Delayed" value={overview.delayed_trips} />
        <Kpi label="Completed" value={analytics.completed} />
      </dl>

      <p className="text-sm text-slate-500">
        Average delay {Number(overview.avg_delay_minutes).toFixed(0)} min · average run{' '}
        {analytics.averageDuration} min · {overview.active_routes} routes · {overview.offline_buses}{' '}
        offline
      </p>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Route performance</h2>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {catalogue.map((route) => (
            <li key={route.route_id} className="rounded-2xl bg-white px-4 py-3 text-sm ring-1 ring-slate-200">
              <p className="font-medium">{route.name}</p>
              <p className="mt-1 text-slate-500">
                {route.active_trip_count} running · {route.delayed_trip_count} delayed ·{' '}
                {route.expected_duration_min} min scheduled
              </p>
            </li>
          ))}
        </ul>
      </section>

      <FleetTools buses={buses} routes={catalogue} />

      <section className="flex flex-col gap-2">
        {trips.length === 0 ? (
          <EmptyState title="No buses to assign" detail="Drivers start a run from Drive." />
        ) : (
          <OperationsBoard drivers={drivers} routes={routes} trips={trips} />
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Announcements</h2>
        {alerts.length === 0 ? (
          <EmptyState title="No announcements" />
        ) : (
          <ul className="flex flex-col gap-2">
            {alerts.map((alert) => (
              <li key={alert.id} className="rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200">
                <p className="font-medium">{alert.title}</p>
                <p className="mt-1 text-slate-500">{alert.message}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className="mt-1 text-3xl font-semibold tracking-tight">{value}</dd>
    </div>
  );
}
