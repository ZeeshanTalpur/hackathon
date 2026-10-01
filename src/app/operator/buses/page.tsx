import { assignBusDriver, createBus, updateBusStatus } from '@/app/operator/actions';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { TimeAgo } from '@/components/time-ago';
import { Badge, Card, ErrorNote, RouteChip, StatCard, TableWrap, Td, Th, inputClass } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { busStatusTone, gpsLabel, titleCase } from '@/lib/format';
import { loadFleet, loadReference } from '@/lib/operator/queries';
import { createClient } from '@/lib/supabase/server';
import type { BusStatus } from '@/lib/types/database';

export const metadata = { title: 'Buses · Daily Transit' };

const STATUSES: BusStatus[] = ['active', 'idle', 'maintenance', 'offline'];

export default async function BusesPage() {
  await requireStaff();
  const supabase = await createClient();
  const [{ fleet, error: fleetError }, ref] = await Promise.all([loadFleet(supabase), loadReference(supabase)]);

  const fleetByBus = new Map(fleet.map((f) => [f.bus_id, f]));
  const count = (s: BusStatus) => ref.buses.filter((b) => b.status === s).length;

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold">Buses</h1>
        <p className="text-sm opacity-70">
          Status, assigned driver and current route. Active = in service; idle, maintenance and offline buses are out of service.
        </p>
      </div>

      {fleetError || ref.error ? <ErrorNote message={(fleetError ?? ref.error) as string} /> : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Active" value={count('active')} tone="good" />
        <StatCard label="Idle" value={count('idle')} />
        <StatCard label="Maintenance" value={count('maintenance')} tone={count('maintenance') ? 'warn' : 'neutral'} />
        <StatCard label="Offline" value={count('offline')} tone={count('offline') ? 'bad' : 'neutral'} />
      </div>

      <Card title={`Fleet (${ref.buses.length})`}>
        <TableWrap>
          <thead>
            <tr>
              <Th>Bus</Th>
              <Th>Status</Th>
              <Th>Assigned driver</Th>
              <Th>Current route / trip</Th>
              <Th>GPS</Th>
            </tr>
          </thead>
          <tbody>
            {ref.buses.map((bus) => {
              const live = fleetByBus.get(bus.id);
              return (
                <tr key={bus.id}>
                  <Td>
                    <span className="font-medium">{bus.label ?? bus.registration_no}</span>
                    <span className="block text-xs opacity-60">
                      {bus.registration_no} · {bus.capacity} seats{bus.has_ac ? ' · AC' : ''}
                    </span>
                  </Td>
                  <Td>
                    <div className="flex flex-col gap-1">
                      <Badge tone={busStatusTone(bus.status)}>{titleCase(bus.status)}</Badge>
                      <ActionForm action={updateBusStatus}>
                        <input type="hidden" name="bus_id" value={bus.id} />
                        <select name="status" defaultValue={bus.status} className={inputClass} aria-label={`Status for ${bus.registration_no}`}>
                          {STATUSES.map((s) => (
                            <option key={s} value={s}>{titleCase(s)}</option>
                          ))}
                        </select>
                        <SubmitButton>Update</SubmitButton>
                      </ActionForm>
                    </div>
                  </Td>
                  <Td>
                    <ActionForm action={assignBusDriver}>
                      <input type="hidden" name="bus_id" value={bus.id} />
                      <select
                        name="driver_id"
                        defaultValue={bus.assigned_driver_id ?? ''}
                        className={`${inputClass} max-w-[11rem]`}
                        aria-label={`Driver for ${bus.registration_no}`}
                      >
                        <option value="">Unassigned</option>
                        {ref.drivers.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.full_name}{d.status !== 'active' ? ` (${d.status.replace('_', ' ')})` : ''}
                          </option>
                        ))}
                      </select>
                      <SubmitButton>Assign</SubmitButton>
                    </ActionForm>
                  </Td>
                  <Td>
                    {live?.trip_id ? (
                      <>
                        <RouteChip code={live.route_code} color={live.route_color} />
                        <span className="block text-xs opacity-60">{live.trip_code} · {live.route_name}</span>
                      </>
                    ) : (
                      <span className="text-xs opacity-60">Not on a trip</span>
                    )}
                  </Td>
                  <Td>
                    {live?.trip_id ? (
                      <Badge tone={gpsLabel(live.gps_status).tone}>{gpsLabel(live.gps_status).text}</Badge>
                    ) : null}
                    <span className="block text-xs opacity-60">
                      Last fix <TimeAgo iso={live?.location_recorded_at ?? null} />
                    </span>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Card>

      <Card title="Add a bus">
        <ActionForm action={createBus} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Registration
            <input name="registration_no" required placeholder="DEMO-KHI-111" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Label
            <input name="label" placeholder="Bus 111" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Capacity
            <input name="capacity" type="number" min={1} max={200} defaultValue={45} className={`${inputClass} w-24`} />
          </label>
          <SubmitButton primary>Add bus</SubmitButton>
        </ActionForm>
        <p className="mt-2 text-xs opacity-60">New buses start as idle with no driver.</p>
      </Card>
    </>
  );
}
