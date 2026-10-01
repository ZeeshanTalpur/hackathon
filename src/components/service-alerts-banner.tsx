import { LiveRefresh } from '@/components/live-refresh';
import { loadPassengerAlerts } from '@/lib/operator/queries';
import { createClient } from '@/lib/supabase/server';

const STYLE = {
  info: 'border-sky-500/40 bg-sky-500/10',
  warning: 'border-amber-500/50 bg-amber-500/10',
  critical: 'border-red-500/50 bg-red-500/10',
} as const;

/**
 * Passenger-facing in-app alerts: every alert that is switched on and inside
 * its time window. Pass `routeIds` on a route / trip screen to show only
 * network-wide alerts plus those for the routes on screen.
 *
 * Server Component - drop it into any passenger page. It refreshes itself
 * through Supabase Realtime when an operator publishes or switches off an
 * alert (service_alerts is in the supabase_realtime publication).
 */
export async function ServiceAlertsBanner({ routeIds, live = true }: { routeIds?: string[]; live?: boolean }) {
  const supabase = await createClient();
  const { alerts } = await loadPassengerAlerts(supabase, routeIds);

  // Label route-specific alerts with the route they concern.
  const alertRouteIds = [...new Set(alerts.map((a) => a.route_id).filter((id): id is string => id !== null))];
  const { data: routes } = alertRouteIds.length
    ? await supabase.from('routes').select('*').in('id', alertRouteIds)
    : { data: [] };
  const routeLabel = new Map((routes ?? []).map((r) => [r.id, `${r.code} · ${r.name}`]));

  if (!alerts.length) return live ? <span hidden><LiveRefresh tables={['service_alerts']} pollMs={60000} /></span> : null;

  return (
    <section aria-label="Service alerts" className="flex flex-col gap-2">
      {alerts.map((alert) => (
        <div key={alert.id} role={alert.severity === 'critical' ? 'alert' : 'status'} className={`rounded-lg border p-3 text-sm ${STYLE[alert.severity]}`}>
          <p className="font-semibold">
            {alert.title}
            {alert.route_id && routeLabel.has(alert.route_id) ? (
              <span className="font-normal opacity-70"> · {routeLabel.get(alert.route_id)}</span>
            ) : null}
          </p>
          <p className="opacity-80">{alert.message}</p>
        </div>
      ))}
      {live ? (
        <span hidden>
          <LiveRefresh tables={['service_alerts']} pollMs={60000} />
        </span>
      ) : null}
    </section>
  );
}
