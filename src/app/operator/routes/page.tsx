import { setRouteActive } from '@/app/operator/actions';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { Badge, Card, ErrorNote, RouteChip } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { loadReference, loadRouteDetails } from '@/lib/operator/queries';
import { createClient } from '@/lib/supabase/server';
import type { TripDirection } from '@/lib/types/database';

export const metadata = { title: 'Routes & stops · Daily Transit' };

export default async function RoutesPage() {
  await requireStaff();
  const supabase = await createClient();
  const [details, ref] = await Promise.all([loadRouteDetails(supabase), loadReference(supabase)]);
  const stopById = new Map(ref.stops.map((s) => [s.id, s]));

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold">Routes &amp; stops</h1>
        <p className="text-sm opacity-70">
          Stop order per direction, distances and timetable offsets. Suspending a route hides it from passenger search.
        </p>
      </div>

      {details.error || ref.error ? <ErrorNote message={(details.error ?? ref.error) as string} /> : null}

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        {details.summary.map((route) => {
          const stopsFor = (direction: TripDirection) =>
            details.routeStops
              .filter((rs) => rs.route_id === route.route_id && rs.direction === direction)
              .sort((a, b) => a.stop_order - b.stop_order);
          return (
            <Card
              key={route.route_id}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  <RouteChip code={route.code} color={route.color} />
                  <span className="font-normal opacity-80">{route.name}</span>
                </span>
              }
              actions={<Badge tone={route.is_active ? 'good' : 'bad'}>{route.is_active ? 'Active' : 'Suspended'}</Badge>}
            >
              <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <div className="min-w-0"><dt className="text-xs opacity-60">From → to</dt><dd className="break-words">{route.origin_stop_name} → {route.destination_stop_name}</dd></div>
                <div><dt className="text-xs opacity-60">Length / time</dt><dd>{Number(route.distance_km)} km · {route.expected_duration_min} min</dd></div>
                <div><dt className="text-xs opacity-60">Stops</dt><dd>{route.outbound_stop_count} out · {route.inbound_stop_count} in</dd></div>
                <div><dt className="text-xs opacity-60">Live trips</dt><dd>{route.active_trip_count}</dd></div>
                <div><dt className="text-xs opacity-60">Delayed now</dt><dd className={route.delayed_trip_count ? 'font-medium text-red-700 dark:text-red-300' : ''}>{route.delayed_trip_count}</dd></div>
                <div><dt className="text-xs opacity-60">Fare / headway</dt><dd>PKR {Number(route.fare_pkr)} · {route.headway_min} min</dd></div>
              </dl>

              {(['outbound', 'inbound'] as TripDirection[]).map((direction) => {
                const rows = stopsFor(direction);
                if (!rows.length) return null;
                return (
                  <details key={direction} className="mt-3 text-sm">
                    <summary className="cursor-pointer select-none py-2 font-medium">
                      {direction === 'outbound' ? 'Outbound' : 'Inbound'} stop order ({rows.length})
                    </summary>
                    <ol className="mt-2 flex flex-col gap-1">
                      {rows.map((rs) => (
                        <li key={rs.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="w-6 text-right text-xs tabular-nums opacity-60">{rs.stop_order}.</span>
                          <span className={`min-w-0 flex-1 ${rs.is_major_stop ? 'font-medium' : ''}`}>{stopById.get(rs.stop_id)?.name ?? rs.stop_id}</span>
                          <span className="text-xs tabular-nums opacity-60">
                            {Number(rs.distance_from_start_km)} km · +{rs.scheduled_offset_min} min
                          </span>
                        </li>
                      ))}
                    </ol>
                  </details>
                );
              })}

              <ActionForm action={setRouteActive} className="mt-4 flex flex-wrap items-center gap-2">
                <input type="hidden" name="route_id" value={route.route_id} />
                <input type="hidden" name="is_active" value={route.is_active ? 'false' : 'true'} />
                <SubmitButton>{route.is_active ? 'Suspend route' : 'Activate route'}</SubmitButton>
              </ActionForm>
            </Card>
          );
        })}
      </div>

      <Card title={`All stops (${ref.stops.length})`}>
        <ul className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {ref.stops.map((s) => (
            <li key={s.id} className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 break-words">
                {s.name} {!s.is_active ? <Badge tone="bad">Inactive</Badge> : null}
              </span>
              <span className="shrink-0 text-xs opacity-60">{s.area ?? s.code}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
