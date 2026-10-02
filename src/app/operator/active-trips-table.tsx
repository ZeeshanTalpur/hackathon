import Link from 'next/link';

import { TimeAgo } from '@/components/time-ago';
import { Badge, RouteChip, TableWrap, Td, Th } from '@/components/ui';
import { delayLabel, gpsLabel, karachiTime, mapsLink } from '@/lib/format';
import type { LiveTrip } from '@/lib/operator/queries';

/** GPS considered stale after 3 minutes - same threshold as the views. */
const GPS_STALE_SEC = 180;

export function ActiveTripsTable({ trips }: { trips: LiveTrip[] }) {
  return (
    <TableWrap>
      <thead>
        <tr>
          <Th>Route</Th>
          <Th>Bus / driver</Th>
          <Th>Status</Th>
          <Th>Next stop · ETA</Th>
          <Th>Current location</Th>
          <Th>Last GPS update</Th>
        </tr>
      </thead>
      <tbody>
        {trips.map((t) => {
          const delay = delayLabel(t.delay_minutes);
          const gps = gpsLabel(t.gps_status);
          const link = mapsLink(t.latitude, t.longitude);
          const eta = t.nextStopEta;
          return (
            <tr key={t.trip_id}>
              <Td label="Route">
                <RouteChip code={t.route_code} color={t.route_color} />
                <span className="block text-xs opacity-60">{t.route_name} · {t.direction}</span>
              </Td>
              <Td label="Bus / driver">
                <span className="font-medium">{t.bus_label ?? t.registration_no}</span>
                <span className="block text-xs opacity-60">{t.driver_name ?? 'No driver'}</span>
                <Link className="text-sm underline" href={`/track/${t.trip_id}`}>
                  Live tracking
                </Link>
              </Td>
              <Td label="Status">
                <div className="flex flex-col items-start gap-1">
                  <Badge tone={delay.tone}>{delay.text}</Badge>
                  <Badge tone={gps.tone}>{gps.text}</Badge>
                </div>
              </Td>
              <Td label="Next stop">
                <span className="font-medium">{t.next_stop_name ?? '—'}</span>
                {eta ? (
                  <span className="block text-xs opacity-70">
                    {t.gps_status === 'live' ? `${eta.eta_minutes} min` : `~${eta.eta_minutes} min (from old fix)`} ·{' '}
                    {karachiTime(eta.estimated_arrival_at)}
                    {eta.projected_delay_minutes > 0 ? ` · ${eta.projected_delay_minutes} min behind timetable` : ''}
                  </span>
                ) : (
                  <span className="block text-xs opacity-60">No ETA</span>
                )}
              </Td>
              <Td label="Location">
                {link ? (
                  <a className="text-xs underline" href={link} target="_blank" rel="noreferrer">
                    {Number(t.latitude).toFixed(4)}, {Number(t.longitude).toFixed(4)}
                  </a>
                ) : (
                  <span className="text-xs opacity-60">No position</span>
                )}
                <span className="block text-xs opacity-60">
                  {Number(t.progress_pct)}% of route{t.speed_kmh !== null ? ` · ${Math.round(Number(t.speed_kmh))} km/h` : ''}
                </span>
              </Td>
              <Td label="Last GPS"><TimeAgo iso={t.location_recorded_at} staleAfterSec={GPS_STALE_SEC} /></Td>
            </tr>
          );
        })}
      </tbody>
    </TableWrap>
  );
}
