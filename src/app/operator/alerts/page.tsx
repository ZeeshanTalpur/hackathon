import { AlertForm } from '@/app/operator/alerts/alert-form';
import { setAlertActive } from '@/app/operator/actions';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { Badge, Card, Empty, ErrorNote, RouteChip } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { isAlertLive, karachiTime, type Tone } from '@/lib/format';
import { loadAlerts, loadReference } from '@/lib/operator/queries';
import { createClient } from '@/lib/supabase/server';
import type { ServiceAlert } from '@/lib/types/database';

export const metadata = { title: 'Service alerts · Karachi Transit' };

const SEVERITY_TONE: Record<ServiceAlert['severity'], Tone> = { info: 'info', warning: 'warn', critical: 'bad' };

function state(alert: ServiceAlert, now: number): { label: string; tone: Tone } {
  if (isAlertLive(alert, now)) return { label: 'Live', tone: 'good' };
  if (!alert.is_active) return { label: 'Switched off', tone: 'neutral' };
  if (new Date(alert.starts_at).getTime() > now) return { label: 'Scheduled', tone: 'info' };
  return { label: 'Expired', tone: 'neutral' };
}

export default async function AlertsPage() {
  await requireStaff();
  const supabase = await createClient();
  const [{ alerts, fetchedAt: now, error }, ref] = await Promise.all([loadAlerts(supabase), loadReference(supabase)]);
  const routeById = new Map(ref.routes.map((r) => [r.id, r]));
  const busById = new Map(ref.buses.map((b) => [b.id, b]));

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold">Service alerts</h1>
        <p className="text-sm opacity-70">In-app alerts. Live alerts appear on the passenger screens immediately.</p>
      </div>

      {error || ref.error ? <ErrorNote message={(error ?? ref.error) as string} /> : null}

      <Card title="Publish an alert">
        <AlertForm routes={ref.routes.map((r) => ({ id: r.id, code: r.code, name: r.name }))} />
      </Card>

      <Card title={`All alerts (${alerts.length})`}>
        {alerts.length === 0 ? (
          <Empty>No alerts yet.</Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-black/10 dark:divide-white/10">
            {alerts.map((alert) => {
              const s = state(alert, now);
              const route = alert.route_id ? routeById.get(alert.route_id) : undefined;
              const bus = alert.bus_id ? busById.get(alert.bus_id) : undefined;
              return (
                <li key={alert.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={s.tone}>{s.label}</Badge>
                      <Badge tone={SEVERITY_TONE[alert.severity]}>{alert.severity}</Badge>
                      {route ? <RouteChip code={route.code} color={route.color} /> : <span className="text-xs opacity-60">Network-wide</span>}
                      {bus ? <span className="text-xs opacity-60">· {bus.label ?? bus.registration_no}</span> : null}
                    </div>
                    <p className="font-medium">{alert.title}</p>
                    <p className="text-sm opacity-80">{alert.message}</p>
                    <p className="text-xs opacity-60">
                      {karachiTime(alert.starts_at)} – {alert.ends_at ? karachiTime(alert.ends_at) : 'until switched off'}
                    </p>
                  </div>
                  <ActionForm action={setAlertActive} className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
                    <input type="hidden" name="alert_id" value={alert.id} />
                    <input type="hidden" name="is_active" value={alert.is_active ? 'false' : 'true'} />
                    <SubmitButton>{alert.is_active ? 'Switch off' : 'Switch on'}</SubmitButton>
                  </ActionForm>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
