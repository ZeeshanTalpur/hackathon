import { NextResponse } from 'next/server';

import { getSessionContext } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Operator actions: assign a driver, move a scheduled trip onto another route,
 * and publish an announcement passengers can read.
 */
export async function POST(request: Request) {
  const session = await getSessionContext();
  if (!session) {
    return NextResponse.json({ error: 'Sign in as an operator.' }, { status: 401 });
  }
  if (session.role !== 'operator' && session.role !== 'admin') {
    return NextResponse.json({ error: 'Only the operations desk can do this.' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
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
    if (body.action === 'assign_driver') {
      const tripId = String(body.tripId ?? '');
      const driverId = String(body.driverId ?? '');
      if (!tripId || !driverId) {
        return NextResponse.json({ error: 'Choose a driver.' }, { status: 400 });
      }

      const { data: trip, error } = await admin
        .from('trips')
        .select('bus_id')
        .eq('id', tripId)
        .single();
      if (error || !trip) throw new Error('Trip not found.');

      const { error: tripError } = await admin
        .from('trips')
        .update({ driver_id: driverId })
        .eq('id', tripId);
      if (tripError) throw new Error(tripError.message);

      await admin.from('buses').update({ assigned_driver_id: driverId }).eq('id', trip.bus_id);
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'assign_route') {
      const tripId = String(body.tripId ?? '');
      const routeId = String(body.routeId ?? '');
      if (!tripId || !routeId) {
        return NextResponse.json({ error: 'Choose a route.' }, { status: 400 });
      }

      const { data: trip, error } = await admin
        .from('trips')
        .select('id, status, scheduled_start_at, direction')
        .eq('id', tripId)
        .single();
      if (error || !trip) throw new Error('Trip not found.');
      if (trip.status !== 'scheduled') {
        throw new Error('A route can be changed only before the bus has left.');
      }

      const { data: stops, error: stopError } = await admin
        .from('route_stops')
        .select('id, stop_id, stop_order, scheduled_offset_min, distance_from_start_km')
        .eq('route_id', routeId)
        .eq('direction', trip.direction)
        .order('stop_order');
      if (stopError) throw new Error(stopError.message);
      if (!stops || stops.length < 2) throw new Error('That route has no stops in this direction.');

      const start = new Date(trip.scheduled_start_at).getTime();
      const next = stops.find((stop) => Number(stop.distance_from_start_km) > 0) ?? stops[1];

      const { error: updateError } = await admin
        .from('trips')
        .update({
          route_id: routeId,
          progress_km: 0,
          last_stop_order: stops[0].stop_order,
          next_stop_id: next.stop_id,
        })
        .eq('id', tripId);
      if (updateError) throw new Error(updateError.message);

      await admin.from('trip_stop_times').delete().eq('trip_id', tripId);
      const { error: insertError } = await admin.from('trip_stop_times').insert(
        stops.map((stop) => ({
          trip_id: tripId,
          route_stop_id: stop.id,
          stop_id: stop.stop_id,
          stop_order: stop.stop_order,
          scheduled_arrival_at: new Date(
            start + Number(stop.scheduled_offset_min) * 60_000,
          ).toISOString(),
          status: 'pending' as const,
        })),
      );
      if (insertError) throw new Error(insertError.message);

      return NextResponse.json({ ok: true });
    }

    if (body.action === 'announce') {
      const title = String(body.title ?? '').trim();
      const message = String(body.message ?? '').trim();
      if (title.length < 3 || message.length < 3) {
        return NextResponse.json({ error: 'Write a short title and message.' }, { status: 400 });
      }

      const { error } = await admin.from('service_alerts').insert({
        title,
        message,
        severity: 'warning',
        is_active: true,
        starts_at: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'set_bus_status') {
      const busId = String(body.busId ?? '');
      const status = String(body.status ?? '');
      if (!busId || !['active', 'idle', 'maintenance', 'offline'].includes(status)) {
        return NextResponse.json({ error: 'Choose a bus status.' }, { status: 400 });
      }
      const { error } = await admin
        .from('buses')
        .update({ status: status as 'active' | 'idle' | 'maintenance' | 'offline' })
        .eq('id', busId);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'set_route_active') {
      const routeId = String(body.routeId ?? '');
      const active = body.active === true || body.active === 'true';
      if (!routeId) return NextResponse.json({ error: 'Choose a route.' }, { status: 400 });
      const { error } = await admin.from('routes').update({ is_active: active }).eq('id', routeId);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not update operations.' },
      { status: 409 },
    );
  }
}
