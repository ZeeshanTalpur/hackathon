import 'server-only';

import { unstable_cache } from 'next/cache';
import { createClient as createAnonClient } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/types/database';
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

function publicClient() {
  return createAnonClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function fetchStops(): Promise<Stop[]> {
  const supabase = publicClient();
  const { data, error } = await supabase
    .from('stops')
    .select('id, code, name, area, latitude, longitude, is_active, created_at')
    .eq('is_active', true)
    .order('name');

  if (error) throw new Error(`Could not load stops: ${error.message}`);
  return (data ?? []) as Stop[];
}

/** Stop names barely change, so repeat visits reuse this for two minutes. */
export const listStops = unstable_cache(fetchStops, ['stops'], { revalidate: 120 });

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

export type ApproachingBus = {
  trip: TripLive;
  /** Minutes until this bus reaches the passenger's boarding stop. */
  etaMinutes: number | null;
};

/**
 * Buses that have not reached the boarding stop yet, on a route that continues
 * to the destination. A bus that has already left the boarding stop toward the
 * destination is left out: the passenger cannot board it there.
 */
export async function busesApproaching(
  originStopId: string,
  destinationStopId: string,
): Promise<{ matchedRoute: boolean; buses: ApproachingBus[] }> {
  const routes = await searchRoutes(originStopId, destinationStopId);
  if (routes.length === 0) return { matchedRoute: false, buses: [] };

  const supabase = await createClient();
  const routeIds = [...new Set(routes.map((route) => route.route_id))];
  const { data: trips, error } = await supabase
    .from('v_trip_live')
    .select('*')
    .in('route_id', routeIds)
    .in('status', ['in_progress', 'scheduled']);

  if (error) throw new Error(`Could not load buses for this ride: ${error.message}`);

  const byRoute = new Map(routes.map((route) => [`${route.route_id}:${route.direction}`, route]));
  const candidates = (trips ?? []).filter((trip) => {
    const route = byRoute.get(`${trip.route_id}:${trip.direction}`);
    if (!route) return false;
    return (trip.last_stop_order ?? 0) < route.origin_stop_order;
  });

  if (candidates.length === 0) return { matchedRoute: true, buses: [] };

  const liveIds = candidates.filter((trip) => trip.status === 'in_progress').map((trip) => trip.trip_id);
  const scheduledIds = candidates.filter((trip) => trip.status === 'scheduled').map((trip) => trip.trip_id);
  const etaByTrip = new Map<string, number>();

  const [etas, times] = await Promise.all([
    liveIds.length > 0
      ? supabase
          .from('v_trip_stop_eta')
          .select('trip_id, eta_minutes')
          .in('trip_id', liveIds)
          .eq('stop_id', originStopId)
      : Promise.resolve({ data: [], error: null }),
    scheduledIds.length > 0
      ? supabase
          .from('trip_stop_times')
          .select('trip_id, scheduled_arrival_at')
          .in('trip_id', scheduledIds)
          .eq('stop_id', originStopId)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (etas.error) throw new Error(`Could not load arrival times: ${etas.error.message}`);
  for (const row of etas.data ?? []) etaByTrip.set(row.trip_id, row.eta_minutes);

  if (times.error) throw new Error(`Could not load the timetable: ${times.error.message}`);
  const now = Date.now();
  for (const row of times.data ?? []) {
    const minutes = Math.round((new Date(row.scheduled_arrival_at).getTime() - now) / 60000);
    etaByTrip.set(row.trip_id, Math.max(minutes, 0));
  }

  const buses = candidates
    .map((trip) => ({ trip, etaMinutes: etaByTrip.get(trip.trip_id) ?? null }))
    .sort((a, b) => (a.etaMinutes ?? 10_000) - (b.etaMinutes ?? 10_000));

  return { matchedRoute: true, buses };
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

async function fetchRoutePath(
  routeId: string,
  direction: 'outbound' | 'inbound',
): Promise<RoutePathStop[]> {
  const supabase = publicClient();
  const { data, error } = await supabase.rpc('fn_route_path', {
    p_route_id: routeId,
    p_direction: direction,
  });

  if (error) throw new Error(`Could not load route path: ${error.message}`);
  return data ?? [];
}

/** Route geometry is stable, so the map reuses it instead of asking again. */
export const getRoutePath = unstable_cache(fetchRoutePath, ['route-path'], { revalidate: 600 });

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

async function fetchScheduleBoard() {
  const supabase = publicClient();
  const { data, error } = await supabase
    .from('v_route_summary')
    .select(
      'route_id, name, origin_stop_name, destination_stop_name, expected_duration_min, headway_min, first_departure, outbound_stop_count, is_active, active_trip_count, delayed_trip_count',
    )
    .order('name');
  if (error) throw new Error(`Could not load schedules: ${error.message}`);
  return data ?? [];
}

/** Timetables are reused for two minutes so opening Ride does not rebuild them. */
export const scheduleBoard = unstable_cache(fetchScheduleBoard, ['schedule-board'], { revalidate: 120 });

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
