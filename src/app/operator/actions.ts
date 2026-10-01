'use server';

import { revalidatePath } from 'next/cache';

import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { AlertSeverity, BusStatus, DriverStatus } from '@/lib/types/database';

/**
 * Operator / admin mutations. Every action:
 *   1. re-checks the role server-side (requireStaff) - never trust the UI,
 *   2. validates its input against an allow-list,
 *   3. writes with the caller's RLS-scoped client, so fn_is_staff() in the
 *      database enforces the same rule a second time,
 *   4. selects the changed row back, because an UPDATE filtered out by RLS
 *      succeeds with zero rows instead of raising an error.
 */

export type ActionState = { ok: boolean; message: string } | null;

const BUS_STATUSES: BusStatus[] = ['active', 'idle', 'maintenance', 'offline'];
const DRIVER_STATUSES: DriverStatus[] = ['active', 'off_duty', 'on_leave'];
const SEVERITIES: AlertSeverity[] = ['info', 'warning', 'critical'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function uuid(formData: FormData, key: string): string | null {
  const value = text(formData, key);
  return UUID.test(value) ? value : null;
}

function done(changed: unknown[] | null, error: { message: string } | null, success: string): ActionState {
  if (error) return { ok: false, message: error.message };
  if (!changed || changed.length === 0) {
    return { ok: false, message: 'Nothing was changed - the record was not found or you are not allowed to edit it.' };
  }
  revalidatePath('/operator', 'layout');
  revalidatePath('/admin');
  revalidatePath('/');
  return { ok: true, message: success };
}

// ---------------------------------------------------------------------------
// Buses
// ---------------------------------------------------------------------------

export async function updateBusStatus(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireStaff();
  const busId = uuid(formData, 'bus_id');
  const status = text(formData, 'status') as BusStatus;
  if (!busId || !BUS_STATUSES.includes(status)) return { ok: false, message: 'Invalid bus or status.' };

  const supabase = await createClient();
  const { data, error } = await supabase.from('buses').update({ status }).eq('id', busId).select('id');
  return done(data, error, `Bus status set to ${status}.`);
}

export async function assignBusDriver(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireStaff();
  const busId = uuid(formData, 'bus_id');
  const rawDriver = text(formData, 'driver_id');
  const driverId = rawDriver === '' ? null : uuid(formData, 'driver_id');
  if (!busId || (rawDriver !== '' && !driverId)) return { ok: false, message: 'Invalid bus or driver.' };

  const supabase = await createClient();

  // One bus per driver: release the driver from any other bus first.
  if (driverId) {
    const release = await supabase
      .from('buses')
      .update({ assigned_driver_id: null })
      .eq('assigned_driver_id', driverId)
      .neq('id', busId);
    if (release.error) return { ok: false, message: release.error.message };
  }

  const { data, error } = await supabase
    .from('buses')
    .update({ assigned_driver_id: driverId })
    .eq('id', busId)
    .select('id');
  return done(data, error, driverId ? 'Driver assigned.' : 'Driver unassigned.');
}

export async function createBus(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireStaff();
  const registration = text(formData, 'registration_no').toUpperCase();
  const label = text(formData, 'label');
  const capacity = Number(text(formData, 'capacity') || '45');
  if (!/^[A-Z0-9-]{3,20}$/.test(registration)) {
    return { ok: false, message: 'Registration must be 3-20 letters, digits or dashes.' };
  }
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 200) {
    return { ok: false, message: 'Capacity must be a whole number between 1 and 200.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('buses')
    .insert({ registration_no: registration, label: label || null, capacity, status: 'idle' })
    .select('id');
  return done(data, error, `Bus ${registration} added.`);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function setRouteActive(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireStaff();
  const routeId = uuid(formData, 'route_id');
  const active = text(formData, 'is_active');
  if (!routeId || (active !== 'true' && active !== 'false')) return { ok: false, message: 'Invalid route.' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('routes')
    .update({ is_active: active === 'true' })
    .eq('id', routeId)
    .select('id');
  return done(data, error, active === 'true' ? 'Route activated.' : 'Route suspended.');
}

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

export async function updateDriverStatus(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireStaff();
  const driverId = uuid(formData, 'driver_id');
  const status = text(formData, 'status') as DriverStatus;
  if (!driverId || !DRIVER_STATUSES.includes(status)) return { ok: false, message: 'Invalid driver or status.' };

  const supabase = await createClient();
  const { data, error } = await supabase.from('drivers').update({ status }).eq('id', driverId).select('id');
  return done(data, error, `Driver status set to ${status.replace('_', ' ')}.`);
}

// ---------------------------------------------------------------------------
// Service alerts
// ---------------------------------------------------------------------------

export async function createAlert(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireStaff();
  const title = text(formData, 'title');
  const message = text(formData, 'message');
  const severity = text(formData, 'severity') as AlertSeverity;
  const rawRoute = text(formData, 'route_id');
  const routeId = rawRoute === '' ? null : uuid(formData, 'route_id');
  const durationMin = Number(text(formData, 'duration_min') || '0');

  if (title.length < 3 || title.length > 120) return { ok: false, message: 'Title must be 3-120 characters.' };
  if (message.length < 3 || message.length > 500) return { ok: false, message: 'Message must be 3-500 characters.' };
  if (!SEVERITIES.includes(severity)) return { ok: false, message: 'Invalid severity.' };
  if (rawRoute !== '' && !routeId) return { ok: false, message: 'Invalid route.' };
  if (!Number.isFinite(durationMin) || durationMin < 0 || durationMin > 7 * 24 * 60) {
    return { ok: false, message: 'Duration must be between 0 (until switched off) and 7 days.' };
  }

  const now = new Date();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('service_alerts')
    .insert({
      title,
      message,
      severity,
      route_id: routeId,
      starts_at: now.toISOString(),
      ends_at: durationMin > 0 ? new Date(now.getTime() + durationMin * 60000).toISOString() : null,
      is_active: true,
    })
    .select('id');
  return done(data, error, 'Alert published - passengers can see it now.');
}

export async function setAlertActive(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireStaff();
  const alertId = uuid(formData, 'alert_id');
  const active = text(formData, 'is_active');
  if (!alertId || (active !== 'true' && active !== 'false')) return { ok: false, message: 'Invalid alert.' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('service_alerts')
    .update({ is_active: active === 'true' })
    .eq('id', alertId)
    .select('id');
  return done(data, error, active === 'true' ? 'Alert re-activated.' : 'Alert switched off.');
}
