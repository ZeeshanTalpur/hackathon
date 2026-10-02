import 'server-only';

import { isAlertLive } from '@/lib/format';
import type { createClient } from '@/lib/supabase/server';
import type {
  ActiveTrip,
  Bus,
  Driver,
  FleetOverview,
  FleetStatus,
  Profile,
  Route,
  RouteStop,
  RouteSummary,
  ServiceAlert,
  Stop,
  Trip,
  TripStopEta,
} from '@/lib/types/database';

/**
 * Read models for the operator/admin screens. Everything goes through the
 * caller's (RLS-scoped) server client and the existing views - no service-role
 * key, no new SQL. Each loader returns `{ data, error }`-style results so a
 * page can show what loaded and flag what did not.
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type NextStopEta = Pick<
  TripStopEta,
  'eta_minutes' | 'estimated_arrival_at' | 'projected_delay_minutes'
>;

export type LiveTrip = ActiveTrip & { nextStopEta: NextStopEta | null };

function firstError(...errors: ({ message: string } | null)[]): string | null {
  return errors.find((e) => e !== null)?.message ?? null;
}

/** Live trips with the ETA to each trip's next stop attached. */
export async function loadLiveTrips(supabase: Supabase) {
  const trips = await supabase
    .from('v_active_trips')
    .select('*')
    .order('is_delayed', { ascending: false })
    .order('delay_minutes', { ascending: false });

  const rows = trips.data ?? [];
  const ids = rows.map((t) => t.trip_id);
  const nextStopIds = [...new Set(rows.map((t) => t.next_stop_id).filter((id): id is string => Boolean(id)))];
  const etas =
    ids.length && nextStopIds.length
      ? await supabase
          .from('v_trip_stop_eta')
          .select('trip_id, stop_id, eta_minutes, estimated_arrival_at, projected_delay_minutes')
          .in('trip_id', ids)
          .in('stop_id', nextStopIds)
      : { data: [] as (NextStopEta & { trip_id: string; stop_id: string })[], error: null };

  const byStop = new Map<string, NextStopEta>();
  for (const row of etas.data ?? []) {
    byStop.set(`${row.trip_id}:${row.stop_id}`, row);
  }

  return {
    trips: rows.map<LiveTrip>((t) => ({
      ...t,
      nextStopEta: t.next_stop_id ? (byStop.get(`${t.trip_id}:${t.next_stop_id}`) ?? null) : null,
    })),
    error: firstError(trips.error, etas.error),
  };
}

export async function loadOverview(supabase: Supabase) {
  const { data, error } = await supabase.from('v_fleet_overview').select('*').maybeSingle();
  return { overview: (data ?? null) as FleetOverview | null, error: error?.message ?? null };
}

export async function loadFleet(supabase: Supabase) {
  const { data, error } = await supabase.from('v_fleet_status').select('*').order('registration_no');
  return { fleet: (data ?? []) as FleetStatus[], error: error?.message ?? null };
}

export async function loadReference(supabase: Supabase) {
  const [routes, buses, drivers, stops] = await Promise.all([
    supabase.from('routes').select('*').order('code'),
    supabase.from('buses').select('*').order('registration_no'),
    supabase.from('drivers').select('*').order('full_name'),
    supabase.from('stops').select('*').order('name'),
  ]);
  return {
    routes: (routes.data ?? []) as Route[],
    buses: (buses.data ?? []) as Bus[],
    drivers: (drivers.data ?? []) as Driver[],
    stops: (stops.data ?? []) as Stop[],
    error: firstError(routes.error, buses.error, drivers.error, stops.error),
  };
}

export async function loadRouteDetails(supabase: Supabase) {
  const [summary, routeStops] = await Promise.all([
    supabase.from('v_route_summary').select('*').order('code'),
    supabase.from('route_stops').select('*').order('stop_order'),
  ]);
  return {
    summary: (summary.data ?? []) as RouteSummary[],
    routeStops: (routeStops.data ?? []) as RouteStop[],
    error: firstError(summary.error, routeStops.error),
  };
}

/** Recent trips of any status, newest first (used for completed/history views). */
export async function loadRecentTrips(supabase: Supabase, limit = 100) {
  const { data, error } = await supabase
    .from('trips')
    .select('*')
    .order('scheduled_start_at', { ascending: false })
    .limit(limit);
  return { trips: (data ?? []) as Trip[], error: error?.message ?? null };
}

export async function loadAlerts(supabase: Supabase) {
  const { data, error } = await supabase
    .from('service_alerts')
    .select('*')
    .order('created_at', { ascending: false });
  // Timestamp taken here, not during render, so components stay pure.
  return { alerts: (data ?? []) as ServiceAlert[], fetchedAt: Date.now(), error: error?.message ?? null };
}

/**
 * Alerts a passenger should see right now: switched on and inside their time
 * window. `routeIds`, when given, keeps network-wide alerts (no route) plus
 * alerts for those routes - handy for a route or trip page.
 */
export async function loadPassengerAlerts(supabase: Supabase, routeIds?: string[]) {
  const { data, error } = await supabase
    .from('service_alerts')
    .select('*')
    .eq('is_active', true)
    .order('starts_at', { ascending: false });

  const now = Date.now();
  const alerts = ((data ?? []) as ServiceAlert[]).filter(
    (a) => isAlertLive(a, now) && (!routeIds || a.route_id === null || routeIds.includes(a.route_id)),
  );
  return { alerts, error: error?.message ?? null };
}

/** profiles is RLS-filtered: staff see every row, everyone else only their own. */
export async function loadProfiles(supabase: Supabase) {
  const { data, error } = await supabase.from('profiles').select('*').order('role').order('full_name');
  return { profiles: (data ?? []) as Profile[], error: error?.message ?? null };
}
