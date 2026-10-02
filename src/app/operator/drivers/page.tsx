import { updateDriverStatus } from '@/app/operator/actions';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { Badge, Card, ErrorNote, RouteChip, TableWrap, Td, Th, inputClass } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { delayLabel, gpsLabel, titleCase } from '@/lib/format';
import { loadLiveTrips, loadReference } from '@/lib/operator/queries';
import { createClient } from '@/lib/supabase/server';
import type { DriverStatus } from '@/lib/types/database';

export const metadata = { title: 'Drivers · Daily Transit' };

const STATUSES: DriverStatus[] = ['active', 'off_duty', 'on_leave'];
const TONE = { active: 'good', off_duty: 'neutral', on_leave: 'warn' } as const;

export default async function DriversPage() {
  await requireStaff();
  const supabase = await createClient();
  const [ref, live] = await Promise.all([loadReference(supabase), loadLiveTrips(supabase)]);

  const busByDriver = new Map(ref.buses.filter((b) => b.assigned_driver_id).map((b) => [b.assigned_driver_id, b]));
  const tripByDriver = new Map(live.trips.filter((t) => t.driver_id).map((t) => [t.driver_id, t]));

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold">Drivers</h1>
        <p className="text-sm opacity-70">Assigned bus, duty status and current trip. Assign buses from the Buses page.</p>
      </div>

      {ref.error || live.error ? <ErrorNote message={(ref.error ?? live.error) as string} /> : null}

      <Card title={`Drivers (${ref.drivers.length})`}>
        <TableWrap>
          <thead>
            <tr>
              <Th>Driver</Th>
              <Th>Status</Th>
              <Th>Assigned bus</Th>
              <Th>Current trip</Th>
            </tr>
          </thead>
          <tbody>
            {ref.drivers.map((d) => {
              const bus = busByDriver.get(d.id);
              const trip = tripByDriver.get(d.id);
              return (
                <tr key={d.id}>
                  <Td label="Driver">
                    <span className="font-medium">{d.full_name}</span>
                    <span className="block text-xs opacity-60">
                      Licence {d.license_no}{d.rating !== null ? ` · ★ ${Number(d.rating)}` : ''}
                    </span>
                  </Td>
                  <Td label="Status">
                    <div className="flex flex-col gap-2">
                      <Badge tone={TONE[d.status]}>{titleCase(d.status)}</Badge>
                      <ActionForm action={updateDriverStatus} className="flex w-full flex-col items-stretch gap-2">
                        <input type="hidden" name="driver_id" value={d.id} />
                        <select name="status" defaultValue={d.status} className={inputClass} aria-label={`Status for ${d.full_name}`}>
                          {STATUSES.map((s) => (
                            <option key={s} value={s}>{titleCase(s)}</option>
                          ))}
                        </select>
                        <SubmitButton>Update</SubmitButton>
                      </ActionForm>
                    </div>
                  </Td>
                  <Td label="Assigned bus">
                    {bus ? (
                      <>
                        <span className="font-medium">{bus.label ?? bus.registration_no}</span>
                        <span className="block text-xs opacity-60">{bus.registration_no} · {titleCase(bus.status)}</span>
                      </>
                    ) : (
                      <span className="text-xs opacity-60">No bus</span>
                    )}
                  </Td>
                  <Td label="Current trip">
                    {trip ? (
                      <div className="flex flex-col items-start gap-1">
                        <RouteChip code={trip.route_code} color={trip.route_color} />
                        <span className="text-xs opacity-60">{trip.trip_code} · next {trip.next_stop_name ?? '—'}</span>
                        <span className="flex flex-wrap gap-1">
                          <Badge tone={delayLabel(trip.delay_minutes).tone}>{delayLabel(trip.delay_minutes).text}</Badge>
                          <Badge tone={gpsLabel(trip.gps_status).tone}>{gpsLabel(trip.gps_status).text}</Badge>
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs opacity-60">Not driving</span>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Card>
    </>
  );
}
