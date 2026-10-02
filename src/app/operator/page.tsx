import Link from 'next/link';

import { LiveRefresh } from '@/components/live-refresh';
import { ActiveTripsTable } from '@/app/operator/active-trips-table';
import { TimeAgo } from '@/components/time-ago';
import { Badge, Card, Empty, ErrorNote, RouteChip, StatCard, TableWrap, Td, Th } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { busStatusTone, delayLabel, gpsLabel, titleCase } from '@/lib/format';
import { loadFleet, loadLiveTrips, loadOverview } from '@/lib/operator/queries';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Live operations · Daily Transit' };

export default async function OperatorLivePage() {
  await requireStaff();
  const supabase = await createClient();

  const [{ overview, error: overviewError }, { trips, error: tripsError }, { fleet, error: fleetError }] =
    await Promise.all([loadOverview(supabase), loadLiveTrips(supabase), loadFleet(supabase)]);

  const delayed = trips.filter((t) => t.is_delayed);
  const gpsDown = trips.filter((t) => t.gps_status !== 'live');
  const attention = trips.filter((t) => t.is_delayed || t.gps_status !== 'live');

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Live operations</h1>
          <p className="text-sm opacity-70">Buses on the road right now, their delay and GPS health.</p>
        </div>
        <LiveRefresh tables={['bus_locations', 'trips', 'service_alerts']} />
      </div>

      {overviewError || tripsError || fleetError ? (
        <ErrorNote message={(overviewError ?? tripsError ?? fleetError) as string} />
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Active buses" value={overview?.active_buses ?? '—'} hint={`of ${overview?.total_buses ?? '—'} in fleet`} />
        <StatCard label="Trips in progress" value={trips.length} hint={`${overview?.upcoming_trips ?? 0} scheduled`} />
        <StatCard label="Delayed" value={delayed.length} tone={delayed.length ? 'bad' : 'good'} hint="delay ≥ 5 min" />
        <StatCard label="GPS unavailable" value={gpsDown.length} tone={gpsDown.length ? 'bad' : 'good'} hint="no fix for 3+ min" />
        <StatCard label="Avg delay" value={`${overview?.avg_delay_minutes ?? 0} min`} hint="live trips" />
        <StatCard
          label="Active alerts"
          value={<Link className="underline-offset-2 hover:underline" href="/operator/alerts">{overview?.active_alerts ?? 0}</Link>}
          hint="shown to passengers"
        />
      </div>

      {attention.length ? (
        <Card title={`Needs attention (${attention.length})`}>
          <ul className="flex flex-col gap-2 text-sm">
            {attention.map((t) => (
              <li key={t.trip_id} className="flex flex-wrap items-center gap-2">
                <RouteChip code={t.route_code} color={t.route_color} />
                <span className="font-medium">{t.bus_label ?? t.registration_no}</span>
                {t.is_delayed ? <Badge tone="bad">{delayLabel(t.delay_minutes).text}</Badge> : null}
                {t.gps_status !== 'live' ? <Badge tone="bad">{gpsLabel(t.gps_status).text}</Badge> : null}
                <span className="opacity-70">
                  {t.driver_name ?? 'No driver'} · next {t.next_stop_name ?? '—'} · last fix{' '}
                  <TimeAgo iso={t.location_recorded_at} />
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card title={`Active trips (${trips.length})`} actions={<Link className="text-sm underline" href="/operator/trips">All trips</Link>}>
        {trips.length === 0 ? <Empty>No trips are in progress.</Empty> : <ActiveTripsTable trips={trips} />}
      </Card>

      <Card title={`Fleet (${fleet.length} buses)`} actions={<Link className="text-sm underline" href="/operator/buses">Manage buses</Link>}>
        <TableWrap>
          <thead>
            <tr>
              <Th>Bus</Th>
              <Th>Status</Th>
              <Th>Route / trip</Th>
              <Th>Driver</Th>
              <Th>GPS</Th>
              <Th>Last update</Th>
            </tr>
          </thead>
          <tbody>
            {fleet.map((b) => (
              <tr key={b.bus_id}>
                <Td label="Bus">
                  <span className="font-medium">{b.bus_label ?? b.registration_no}</span>
                  <span className="block text-xs opacity-60">{b.registration_no}</span>
                </Td>
                <Td label="Status">
                  <Badge tone={busStatusTone(b.bus_status)}>{titleCase(b.bus_status)}</Badge>
                  {b.is_delayed ? <span className="ml-1"><Badge tone="bad">Delayed</Badge></span> : null}
                </Td>
                <Td label="Route">
                  <RouteChip code={b.route_code} color={b.route_color} />
                  {b.trip_code ? <span className="block text-xs opacity-60">{b.trip_code}</span> : null}
                </Td>
                <Td label="Driver">{b.driver_name ?? <span className="opacity-50">Unassigned</span>}</Td>
                <Td label="GPS">
                  {b.trip_id ? (
                    <Badge tone={gpsLabel(b.gps_status).tone}>{gpsLabel(b.gps_status).text}</Badge>
                  ) : (
                    <span className="text-xs opacity-60">{b.telemetry_stale ? 'Not reporting' : 'Reporting'}</span>
                  )}
                </Td>
                <Td label="Last update"><TimeAgo iso={b.location_recorded_at} /></Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </>
  );
}
