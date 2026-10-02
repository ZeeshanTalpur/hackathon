import Link from 'next/link';

import { ActiveTripsTable } from '@/app/operator/active-trips-table';
import { LiveRefresh } from '@/components/live-refresh';
import { Badge, Card, Empty, ErrorNote, RouteChip, TableWrap, Td, Th } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { delayLabel, karachiTime, minutesBetween, titleCase, tripStatusTone } from '@/lib/format';
import { loadLiveTrips, loadRecentTrips, loadReference } from '@/lib/operator/queries';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Trips · Daily Transit' };

const VIEWS = ['active', 'delayed', 'gps', 'completed', 'all'] as const;
type View = (typeof VIEWS)[number];

export default async function TripsPage({ searchParams }: PageProps<'/operator/trips'>) {
  await requireStaff();
  const raw = (await searchParams).view;
  const view: View = VIEWS.includes(raw as View) ? (raw as View) : 'active';

  const supabase = await createClient();
  const [live, recent, ref] = await Promise.all([
    loadLiveTrips(supabase),
    loadRecentTrips(supabase, 100),
    loadReference(supabase),
  ]);

  const delayed = live.trips.filter((t) => t.is_delayed);
  const gps = live.trips.filter((t) => t.gps_status !== 'live');
  const completed = recent.trips.filter((t) => t.status === 'completed');

  const tabs: { key: View; label: string; count: number }[] = [
    { key: 'active', label: 'Active', count: live.trips.length },
    { key: 'delayed', label: 'Delayed', count: delayed.length },
    { key: 'gps', label: 'GPS unavailable', count: gps.length },
    { key: 'completed', label: 'Completed', count: completed.length },
    { key: 'all', label: 'All recent', count: recent.trips.length },
  ];

  const routeById = new Map(ref.routes.map((r) => [r.id, r]));
  const busById = new Map(ref.buses.map((b) => [b.id, b]));
  const driverById = new Map(ref.drivers.map((d) => [d.id, d]));
  const historyRows = view === 'completed' ? completed : recent.trips;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Trip monitoring</h1>
          <p className="text-sm opacity-70">Find delayed trips and trips that have lost GPS at a glance.</p>
        </div>
        <LiveRefresh tables={['bus_locations', 'trips']} />
      </div>

      {live.error || recent.error || ref.error ? <ErrorNote message={(live.error ?? recent.error ?? ref.error) as string} /> : null}

      <div className="flex flex-wrap gap-2" role="tablist">
          {tabs.map((tab) => (
            <Link
              key={tab.key}
              href={`/operator/trips?view=${tab.key}`}
              role="tab"
              aria-selected={view === tab.key}
              className={`rounded-full border px-3 py-1 text-sm ${
                view === tab.key ? 'border-foreground bg-foreground text-background' : 'border-black/15 dark:border-white/20'
              }`}
            >
              {tab.label} <span className="tabular-nums opacity-70">{tab.count}</span>
            </Link>
          ))}
      </div>

      {view === 'active' || view === 'delayed' || view === 'gps' ? (
        <Card title={tabs.find((t) => t.key === view)?.label}>
          {(() => {
            const rows = view === 'active' ? live.trips : view === 'delayed' ? delayed : gps;
            return rows.length ? <ActiveTripsTable trips={rows} /> : <Empty>No trips in this view.</Empty>;
          })()}
        </Card>
      ) : (
        <Card title={view === 'completed' ? 'Completed trips' : 'Recent trips (latest 100)'}>
          {historyRows.length === 0 ? (
            <Empty>No trips in this view.</Empty>
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <Th>Trip</Th>
                  <Th>Route</Th>
                  <Th>Bus / driver</Th>
                  <Th>Status</Th>
                  <Th>Scheduled</Th>
                  <Th>Actual</Th>
                  <Th>Delay</Th>
                </tr>
              </thead>
              <tbody>
                {historyRows.map((t) => {
                  const route = routeById.get(t.route_id);
                  const bus = busById.get(t.bus_id);
                  const driver = t.driver_id ? driverById.get(t.driver_id) : undefined;
                  const duration = minutesBetween(t.actual_start_at, t.actual_end_at);
                  const delay = delayLabel(t.delay_minutes);
                  return (
                    <tr key={t.id}>
                      <Td>
                        <span className="font-medium">{t.trip_code}</span>
                        <span className="block text-xs opacity-60">{t.direction}</span>
                      </Td>
                      <Td><RouteChip code={route?.code ?? null} color={route?.color ?? null} /></Td>
                      <Td>
                        {bus?.label ?? bus?.registration_no ?? '—'}
                        <span className="block text-xs opacity-60">{driver?.full_name ?? 'No driver'}</span>
                      </Td>
                      <Td><Badge tone={tripStatusTone(t.status)}>{titleCase(t.status)}</Badge></Td>
                      <Td>{karachiTime(t.scheduled_start_at)} – {karachiTime(t.scheduled_end_at)}</Td>
                      <Td>
                        {karachiTime(t.actual_start_at)} – {karachiTime(t.actual_end_at)}
                        {duration !== null ? <span className="block text-xs opacity-60">{duration} min</span> : null}
                      </Td>
                      <Td><Badge tone={delay.tone}>{delay.text}</Badge></Td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          )}
        </Card>
      )}
    </>
  );
}
