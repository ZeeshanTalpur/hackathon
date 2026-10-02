import { formatDelay } from '@/components/trip-status';
import { NotificationMenu, type NoticeItem } from '@/components/notification-menu';
import { SUPABASE_CONFIGURED, operatorTrips } from '@/lib/data/transit';
import { loadPassengerAlerts } from '@/lib/operator/queries';
import { createClient } from '@/lib/supabase/server';

/** Bell for passenger, driver, and operator pages. Alerts open in a readable panel. */
export async function NotificationBell({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  if (!SUPABASE_CONFIGURED) return null;

  let items: NoticeItem[] = [];
  try {
    const supabase = await createClient();
    const [{ alerts }, running] = await Promise.all([loadPassengerAlerts(supabase), operatorTrips()]);
    const delays = running.filter((trip) => trip.status === 'in_progress' && trip.is_delayed).slice(0, 8);

    items = [
      ...alerts.map((alert) => ({
        id: alert.id,
        title: alert.title,
        body: alert.message,
        tone: alert.severity,
      })),
      ...delays.map((trip) => ({
        id: trip.trip_id,
        title: `${trip.bus_label ?? 'Bus'} is delayed`,
        body: [trip.route_name, formatDelay(trip.delay_minutes)].filter(Boolean).join(' · '),
        tone: 'warning' as const,
      })),
    ];
  } catch {
    items = [];
  }

  return <NotificationMenu items={items} tone={tone} />;
}
