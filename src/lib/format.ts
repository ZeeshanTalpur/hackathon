import type { BusStatus, GpsStatus, TripStatus } from '@/lib/types/database';

/**
 * Display helpers shared by Server and Client Components. Pure functions only -
 * no Supabase, no React - so either side can import them.
 *
 * The thresholds mirror the database views so the UI never disagrees with
 * them: a trip is "delayed" at >= 5 minutes (v_active_trips.is_delayed) and a
 * GPS fix older than 3 minutes is "stale" (gps_status, migration 4).
 */

export const DELAY_THRESHOLD_MIN = 5;

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info';

export function delayLabel(delayMinutes: number | null | undefined): { text: string; tone: Tone } {
  if (delayMinutes === null || delayMinutes === undefined) return { text: '—', tone: 'neutral' };
  if (delayMinutes >= DELAY_THRESHOLD_MIN) return { text: `Delayed +${delayMinutes} min`, tone: 'bad' };
  if (delayMinutes > 0) return { text: `+${delayMinutes} min`, tone: 'warn' };
  if (delayMinutes < 0) return { text: `Early ${delayMinutes} min`, tone: 'info' };
  return { text: 'On time', tone: 'good' };
}

export function gpsLabel(status: GpsStatus | null | undefined): { text: string; tone: Tone } {
  switch (status) {
    case 'live':
      return { text: 'GPS live', tone: 'good' };
    case 'stale':
      return { text: 'GPS unavailable', tone: 'bad' };
    default:
      return { text: 'No GPS fix', tone: 'bad' };
  }
}

export function busStatusTone(status: BusStatus): Tone {
  switch (status) {
    case 'active':
      return 'good';
    case 'idle':
      return 'neutral';
    case 'maintenance':
      return 'warn';
    default:
      return 'bad';
  }
}

export function tripStatusTone(status: TripStatus): Tone {
  switch (status) {
    case 'in_progress':
      return 'good';
    case 'scheduled':
      return 'info';
    case 'completed':
      return 'neutral';
    default:
      return 'bad';
  }
}

export function titleCase(value: string): string {
  return value.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/** "45 s ago", "3 min ago", "2 h ago" - relative to `now` (ms). */
export function timeAgo(iso: string | null | undefined, now: number): string {
  if (!iso) return 'never';
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds} s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/** Clock time in Karachi (UTC+5, no DST), e.g. "14:05". */
export function karachiTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Karachi',
  }).format(new Date(iso));
}

export function minutesBetween(startIso: string | null, endIso: string | null): number | null {
  if (!startIso || !endIso) return null;
  return Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
}

export function mapsLink(latitude: number | null, longitude: number | null): string | null {
  if (latitude === null || longitude === null) return null;
  return `https://www.google.com/maps?q=${latitude},${longitude}`;
}

/** An alert is visible to passengers when switched on and inside its time window. */
export function isAlertLive(
  alert: { is_active: boolean; starts_at: string; ends_at: string | null },
  now: number,
): boolean {
  if (!alert.is_active) return false;
  if (new Date(alert.starts_at).getTime() > now) return false;
  return alert.ends_at === null || new Date(alert.ends_at).getTime() > now;
}
