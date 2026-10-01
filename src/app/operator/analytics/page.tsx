import { Card, ErrorNote, RouteChip, StatCard } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { DELAY_THRESHOLD_MIN, minutesBetween } from '@/lib/format';
import { loadOverview, loadRecentTrips, loadReference } from '@/lib/operator/queries';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Analytics · Daily Transit' };

function average(values: number[]): number | null {
  if (!values.length) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

/**
 * Deliberately simple: a handful of KPIs computed from the trips table and
 * v_fleet_overview, plus one ranked bar list. No chart library.
 */
export default async function AnalyticsPage() {
  await requireStaff();
  const supabase = await createClient();
  const [{ overview, error: overviewError }, { trips, error: tripsError }, ref] = await Promise.all([
    loadOverview(supabase),
    loadRecentTrips(supabase, 1000),
    loadReference(supabase),
  ]);

  const completed = trips.filter((t) => t.status === 'completed');
  const inProgress = trips.filter((t) => t.status === 'in_progress');
  const cancelled = trips.filter((t) => t.status === 'cancelled');
  const ran = [...completed, ...inProgress];
  const delayed = ran.filter((t) => t.delay_minutes >= DELAY_THRESHOLD_MIN);
  const onTime = completed.filter((t) => t.delay_minutes < DELAY_THRESHOLD_MIN);
  const durations = completed
    .map((t) => minutesBetween(t.actual_start_at, t.actual_end_at))
    .filter((m): m is number => m !== null);

  const avgDelayCompleted = average(completed.map((t) => t.delay_minutes));
  const avgDuration = average(durations);
  const onTimePct = completed.length ? Math.round((100 * onTime.length) / completed.length) : null;

  // Most active routes: trips that actually ran or are planned (cancelled excluded).
  const counts = new Map<string, { total: number; delayed: number }>();
  for (const t of trips) {
    if (t.status === 'cancelled') continue;
    const c = counts.get(t.route_id) ?? { total: 0, delayed: 0 };
    c.total += 1;
    if (t.status !== 'scheduled' && t.delay_minutes >= DELAY_THRESHOLD_MIN) c.delayed += 1;
    counts.set(t.route_id, c);
  }
  const ranking = ref.routes
    .map((r) => ({ route: r, ...(counts.get(r.id) ?? { total: 0, delayed: 0 }) }))
    .sort((a, b) => b.total - a.total || a.route.code.localeCompare(b.route.code));
  const max = Math.max(1, ...ranking.map((r) => r.total));

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold">Analytics</h1>
        <p className="text-sm opacity-70">
          Computed from the trips recorded in the database (latest {trips.length}). Delayed = {DELAY_THRESHOLD_MIN}+ min late.
        </p>
      </div>

      {overviewError || tripsError || ref.error ? <ErrorNote message={(overviewError ?? tripsError ?? ref.error) as string} /> : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Total buses" value={overview?.total_buses ?? ref.buses.length} />
        <StatCard label="Active buses" value={overview?.active_buses ?? '—'} tone="good" />
        <StatCard label="Active trips" value={inProgress.length} />
        <StatCard label="Completed trips" value={completed.length} hint={cancelled.length ? `${cancelled.length} cancelled` : undefined} />
        <StatCard label="Delayed trips" value={delayed.length} tone={delayed.length ? 'bad' : 'good'} hint="completed + live" />
        <StatCard label="Avg delay" value={avgDelayCompleted === null ? '—' : `${avgDelayCompleted} min`} hint="completed trips" />
        <StatCard label="Avg live delay" value={`${overview?.avg_delay_minutes ?? 0} min`} hint="trips in progress" />
        <StatCard label="Avg trip duration" value={avgDuration === null ? '—' : `${avgDuration} min`} hint="actual start → end" />
        <StatCard label="On-time completion" value={onTimePct === null ? '—' : `${onTimePct}%`} hint={`${onTime.length} of ${completed.length}`} />
        <StatCard label="Routes" value={ref.routes.length} hint={`${ref.routes.filter((r) => r.is_active).length} active`} />
      </div>

      <Card title="Most active routes (trips, excluding cancelled)">
        <ol className="flex flex-col gap-3">
          {ranking.map(({ route, total, delayed: late }) => (
            <li key={route.id} className="grid grid-cols-[minmax(6rem,10rem)_1fr_auto] items-center gap-3 text-sm">
              <span className="truncate" title={route.name}>
                <RouteChip code={route.code} color={route.color} />
              </span>
              <span className="h-3 rounded-sm bg-black/5 dark:bg-white/10" aria-hidden>
                <span
                  className="block h-3 rounded-r bg-slate-600 dark:bg-slate-300"
                  style={{ width: `${(100 * total) / max}%` }}
                  title={`${route.code}: ${total} trips, ${late} delayed`}
                />
              </span>
              <span className="whitespace-nowrap tabular-nums">
                {total} <span className="text-xs opacity-60">({late} delayed)</span>
              </span>
            </li>
          ))}
        </ol>
      </Card>
    </>
  );
}
