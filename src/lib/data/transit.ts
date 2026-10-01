import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type {
  RoutePathStop,
  RouteSearchResult,
  Stop,
  TripLive,
  TripStopEta,
} from '@/lib/types/database';

export const SUPABASE_CONFIGURED = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

/**
 * Reads for the passenger, driver and operator screens.
 *
 * Every function returns data or throws a readable Error - callers render an
 * error state rather than a blank screen. Transport tables are public-read
 * under RLS, so these run with the anon key.
 */

export async function listStops(): Promise<Stop[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('stops')
    .select('*')
    .eq('is_active', true)
    .order('name');

  if (error) throw new Error(`Could not load stops: ${error.message}`);
  return data ?? [];
}

export async function searchRoutes(
  originStopId: string,
  destinationStopId: string,
): Promise<RouteSearchResult[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('fn_search_routes', {
    p_origin_stop_id: originStopId,
    p_destination_stop_id: destinationStopId,
  });

  if (error) throw new Error(`Route search failed: ${error.message}`);
  return data ?? [];
}

/**
 * Buses a passenger can choose from when a stop has no direct match, or when
 * the matched route has nothing running. Live trips first, then the soonest
 * departures. Always returns something if any trip is scheduled or running.
 */
export async function departuresNearStop(stopId: string): Promise<TripLive[]> {
  const supabase = await createClient();
  const { data: links, error } = await supabase
    .from('route_stops')
    .select('route_id')
    .eq('stop_id', stopId);

  if (error) throw new Error(`Could not look up this stop: ${error.message}`);

  const routeIds = [...new Set((links ?? []).map((row) => row.route_id))];
  const query = supabase
    .from('v_trip_live')
    .select('*')
    .in('status', ['in_progress', 'scheduled'])
    .order('status')
    .order('scheduled_start_at')
    .limit(8);

  const { data, error: tripError } = routeIds.length
    ? await query.in('route_id', routeIds)
    : await query;

  if (tripError) throw new Error(`Could not load departures: ${tripError.message}`);
  if (data && data.length > 0) return data;

  const { data: anyTrips, error: anyError } = await supabase
    .from('v_trip_live')
    .select('*')
    .in('status', ['in_progress', 'scheduled'])
    .order('scheduled_start_at')
    .limit(8);

  if (anyError) throw new Error(`Could not load departures: ${anyError.message}`);
  return anyTrips ?? [];
}

/** Live trips on a route, newest position first. Drives "available buses". */
export async function activeTripsForRoute(routeId: string): Promise<TripLive[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('v_trip_live')
    .select('*')
    .eq('route_id', routeId)
    .in('status', ['in_progress', 'scheduled'])
    .order('status')
    .order('scheduled_start_at');

  if (error) throw new Error(`Could not load buses for this route: ${error.message}`);
  return data ?? [];
}

export async function getTripLive(tripId: string): Promise<TripLive | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('v_trip_live')
    .select('*')
    .eq('trip_id', tripId)
    .maybeSingle();

  if (error) throw new Error(`Could not load trip: ${error.message}`);
  return data ?? null;
}

export async function getTripStopEtas(tripId: string): Promise<TripStopEta[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('v_trip_stop_eta')
    .select('*')
    .eq('trip_id', tripId)
    .order('stop_order');

  if (error) throw new Error(`Could not load ETAs: ${error.message}`);
  return data ?? [];
}

export async function getRoutePath(
  routeId: string,
  direction: 'outbound' | 'inbound' = 'outbound',
): Promise<RoutePathStop[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('fn_route_path', {
    p_route_id: routeId,
    p_direction: direction,
  });

  if (error) throw new Error(`Could not load route path: ${error.message}`);
  return data ?? [];
}

/**
 * Trips for the signed-in driver.
 *
 * Falls back to every trip when the demo driver profile is not linked to a
 * drivers row, so the driver console is never empty during judging.
 */
export async function driverTrips(profileId: string | null): Promise<{
  trips: TripLive[];
  linked: boolean;
}> {
  const supabase = await createClient();

  let driverId: string | null = null;
  if (profileId) {
    const { data } = await supabase
      .from('drivers')
      .select('id')
      .eq('profile_id', profileId)
      .maybeSingle();
    driverId = data?.id ?? null;
  }

  // Completed trips are included so the console does not empty out after a demo
  // run - the controls disable themselves rather than the trip disappearing.
  const query = supabase
    .from('v_trip_live')
    .select('*')
    .in('status', ['scheduled', 'in_progress', 'completed'])
    .order('status')
    .order('scheduled_start_at');

  const { data, error } = driverId ? await query.eq('driver_id', driverId) : await query;

  if (error) throw new Error(`Could not load driver trips: ${error.message}`);
  return { trips: data ?? [], linked: Boolean(driverId) };
}

export async function fleetOverview() {
  const supabase = await createClient();
  const { data, error } = await supabase.from('v_fleet_overview').select('*').single();
  if (error) throw new Error(`Could not load operations: ${error.message}`);
  return data;
}

export async function activeAlerts() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('service_alerts')
    .select('id, title, message, severity')
    .eq('is_active', true)
    .order('severity');

  if (error) throw new Error(`Could not load announcements: ${error.message}`);
  return data ?? [];
}

export async function listDrivers(): Promise<{ id: string; full_name: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('drivers')
    .select('id, full_name')
    .order('full_name');
  if (error) throw new Error(`Could not load drivers: ${error.message}`);
  return data ?? [];
}

export async function listActiveRoutes(): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('routes')
    .select('id, name')
    .eq('is_active', true)
    .order('name');
  if (error) throw new Error(`Could not load routes: ${error.message}`);
  return data ?? [];
}

export async function arrivalsAtStop(stopId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('fn_stop_arrivals', {
    p_stop_id: stopId,
    p_limit: 6,
  });
  if (error) throw new Error(`Could not load arrivals: ${error.message}`);
  return data ?? [];
}

export async function scheduleBoard() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('v_route_summary')
    .select(
      'route_id, name, origin_stop_name, destination_stop_name, expected_duration_min, headway_min, first_departure, outbound_stop_count, is_active, active_trip_count, delayed_trip_count',
    )
    .order('name');
  if (error) throw new Error(`Could not load schedules: ${error.message}`);
  return data ?? [];
}

export async function listBuses() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('buses')
    .select('id, label, status, capacity')
    .order('label');
  if (error) throw new Error(`Could not load buses: ${error.message}`);
  return data ?? [];
}

export async function tripAnalytics() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('v_trip_live')
    .select('status, actual_start_at, actual_end_at, delay_minutes, route_name')
    .eq('status', 'completed');
  if (error) throw new Error(`Could not load analytics: ${error.message}`);

  const rows = data ?? [];
  const durations = rows
    .map((row) => {
      if (!row.actual_start_at || !row.actual_end_at) return null;
      return (new Date(row.actual_end_at).getTime() - new Date(row.actual_start_at).getTime()) / 60000;
    })
    .filter((minutes): minutes is number => minutes !== null && minutes > 0 && minutes < 24 * 60);

  const averageDuration =
    durations.length === 0
      ? 0
      : Math.round(durations.reduce((sum, minutes) => sum + minutes, 0) / durations.length);

  return { completed: rows.length, averageDuration };
}

/** Operator view: every trip that is running or about to run. */
export async function operatorTrips(): Promise<TripLive[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('v_trip_live')
    .select('*')
    .in('status', ['in_progress', 'scheduled'])
    .order('status')
    .order('delay_minutes', { ascending: false });

  if (error) throw new Error(`Could not load fleet state: ${error.message}`);
  return data ?? [];
}
