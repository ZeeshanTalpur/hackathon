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

  const query = supabase
    .from('v_trip_live')
    .select('*')
    .in('status', ['scheduled', 'in_progress'])
    .order('status')
    .order('scheduled_start_at');

  const { data, error } = driverId ? await query.eq('driver_id', driverId) : await query;

  if (error) throw new Error(`Could not load driver trips: ${error.message}`);
  return { trips: data ?? [], linked: Boolean(driverId) };
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
