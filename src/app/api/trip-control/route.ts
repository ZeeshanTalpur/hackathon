import { NextResponse } from 'next/server';

import { getSessionContext } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { getTripLive, getTripStopEtas } from '@/lib/data/transit';

/**
 * Trip state changes: start, end, simulated tick, real GPS fix, delay.
 *
 * All writes go through the SQL functions in 20261001150000_trip_control.sql so
 * the location fix, trip progress, next stop and stop arrivals are applied in
 * one transaction. That also means the realtime event a passenger receives is
 * never half-written.
 *
 * Writes use the service-role client, which stays on the server. Callers must
 * be a signed-in driver, operator or admin.
 */

const ACTIONS = ['start', 'end', 'tick', 'gps', 'delay'] as const;
type Action = (typeof ACTIONS)[number];

function isAction(value: unknown): value is Action {
  return typeof value === 'string' && (ACTIONS as readonly string[]).includes(value);
}

/** Live trip state, used to refetch after a realtime event. */
export async function GET(request: Request) {
  const tripId = new URL(request.url).searchParams.get('tripId');
  if (!tripId) {
    return NextResponse.json({ error: 'tripId is required' }, { status: 400 });
  }

  try {
    const [trip, etas] = await Promise.all([getTripLive(tripId), getTripStopEtas(tripId)]);
    if (!trip) {
      return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    }
    return NextResponse.json({ trip, etas });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not load trip' },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
  }

  const { action, tripId } = body;

  if (!isAction(action)) {
    return NextResponse.json(
      { error: `action must be one of ${ACTIONS.join(', ')}` },
      { status: 400 },
    );
  }
  if (typeof tripId !== 'string' || tripId.length === 0) {
    return NextResponse.json({ error: 'tripId is required' }, { status: 400 });
  }

  const session = await getSessionContext();
  if (!session) {
    return NextResponse.json({ error: 'Sign in to control a trip' }, { status: 401 });
  }
  if (!['driver', 'operator', 'admin'].includes(session.role)) {
    return NextResponse.json(
      { error: `Role ${session.role} cannot control trips` },
      { status: 403 },
    );
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Server is not configured' },
      { status: 503 },
    );
  }

  try {
    switch (action) {
      case 'start': {
        const { error } = await admin.rpc('fn_start_trip', { p_trip_id: tripId });
        if (error) throw new Error(error.message);
        break;
      }
      case 'end': {
        const { error } = await admin.rpc('fn_end_trip', { p_trip_id: tripId });
        if (error) throw new Error(error.message);
        break;
      }
      case 'tick': {
        const { error } = await admin.rpc('fn_advance_trip', {
          p_trip_id: tripId,
          p_tick_seconds: numberOr(body.tickSeconds, 5),
          p_speed_kmh: optionalNumber(body.speedKmh),
        });
        if (error) throw new Error(error.message);
        break;
      }
      case 'gps': {
        const latitude = optionalNumber(body.latitude);
        const longitude = optionalNumber(body.longitude);
        if (latitude === undefined || longitude === undefined) {
          return NextResponse.json(
            { error: 'latitude and longitude are required' },
            { status: 400 },
          );
        }
        const { error } = await admin.rpc('fn_record_trip_location', {
          p_trip_id: tripId,
          p_latitude: latitude,
          p_longitude: longitude,
          p_speed_kmh: numberOr(body.speedKmh, 0),
          p_heading_deg: optionalNumber(body.headingDeg),
        });
        if (error) throw new Error(error.message);
        break;
      }
      case 'delay': {
        const { error } = await admin.rpc('fn_set_trip_delay', {
          p_trip_id: tripId,
          p_delay_minutes: numberOr(body.delayMinutes, 0),
        });
        if (error) throw new Error(error.message);
        break;
      }
    }
  } catch (error) {
    // The SQL functions raise readable messages for invalid transitions, e.g.
    // ending a trip that is not in progress. Surface them as 409.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Trip update failed' },
      { status: 409 },
    );
  }

  const trip = await getTripLive(tripId);
  return NextResponse.json({ trip });
}

function numberOr(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
