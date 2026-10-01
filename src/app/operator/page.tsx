import Link from 'next/link';

import { AppShell, DemoDataNotice, EmptyState, ErrorState } from '@/components/app-shell';
import { StatusBadge, formatDelay } from '@/components/trip-status';
import { requireRole } from '@/lib/auth';
import { SUPABASE_CONFIGURED, operatorTrips } from '@/lib/data/transit';
import type { TripLive } from '@/lib/types/database';

export const dynamic = 'force-dynamic';

/**
 * Minimum operator visibility: which bus, which trip, which route, which
 * driver, where it is, what state it is in and how late it is.
 *
 * Deliberately not a full dashboard - v_trip_live and v_fleet_overview already
 * carry everything a richer view would need later.
 */
export default async function OperatorPage() {
  if (!SUPABASE_CONFIGURED) {
    return (
      <AppShell title="Operator">
        <ErrorState
          title="Supabase is not configured"
          detail="Copy .env.example to .env.local and restart the dev server."
        />
      </AppShell>
    );
  }

  await requireRole(['operator', 'admin']);

  // Only the fetch is guarded. JSX built inside a try/catch would give the
  // false impression that render errors are handled here.
  let trips: TripLive[] = [];
  let loadError: string | null = null;

  try {
    trips = await operatorTrips();
  } catch (error) {
    loadError = error instanceof Error ? error.message : 'Database request failed.';
  }

  if (loadError) {
    return (
      <AppShell title="Operator">
        <ErrorState title="Could not load the fleet state" detail={loadError} />
      </AppShell>
    );
  }

  const running = trips.filter((t) => t.status === 'in_progress');
  const delayed = running.filter((t) => t.is_delayed);
  const noFix = running.filter((t) => t.gps_status !== 'live');

  return (
    <AppShell title="Operator">
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <Kpi label="Trips running" value={running.length} />
          <Kpi label="Delayed" value={delayed.length} />
          <Kpi label="No live GPS" value={noFix.length} />
        </dl>

        {trips.length === 0 ? (
          <EmptyState
            title="Nothing scheduled or running"
            detail="Reload supabase/seed.sql to restore the demo schedule."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-black/10 rounded border border-black/15 dark:divide-white/10 dark:border-white/15">
            {trips.map((trip) => (
              <li key={trip.trip_id} className="flex flex-col gap-2 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="rounded px-2 py-0.5 text-xs font-semibold text-white"
                      style={{ backgroundColor: trip.route_color }}
                    >
                      {trip.route_code}
                    </span>
                    <span className="font-medium">{trip.registration_no}</span>
                    <span className="text-xs opacity-60">{trip.trip_code}</span>
                  </div>
                  <StatusBadge state={trip.operational_state} />
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <Fact label="Driver" value={trip.driver_name ?? 'Unassigned'} />
                  <Fact label="Next stop" value={trip.next_stop_name ?? '--'} />
                  <Fact label="Progress" value={`${Number(trip.progress_pct).toFixed(0)}%`} />
                  <Fact
                    label="Position"
                    value={
                      trip.gps_status === 'live' && trip.latitude !== null
                        ? `${Number(trip.latitude).toFixed(4)}, ${Number(trip.longitude).toFixed(4)}`
                        : 'Not live'
                    }
                  />
                </div>

                {formatDelay(trip.delay_minutes) ? (
                  <p className="text-xs text-amber-600">{formatDelay(trip.delay_minutes)}</p>
                ) : null}

                {trip.status === 'in_progress' ? (
                  <Link className="text-xs underline" href={`/track/${trip.trip_id}`}>
                    Open live tracking
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <DemoDataNotice />
    </AppShell>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-black/15 p-3 dark:border-white/15">
      <dt className="text-xs opacity-60">{label}</dt>
      <dd className="text-xl font-semibold">{value}</dd>
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
