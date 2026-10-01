import type { OperationalState } from '@/lib/types/database';

const STATE_STYLE: Record<OperationalState, { label: string; className: string; light: string }> = {
  ON_TIME: { label: 'On time', className: 'bg-emerald-50 text-emerald-800', light: 'bg-emerald-400/15 text-emerald-200' },
  DELAYED: { label: 'Delayed', className: 'bg-amber-50 text-amber-800', light: 'bg-amber-400/15 text-amber-200' },
  STOPPED: { label: 'Stopped', className: 'bg-slate-100 text-slate-700', light: 'bg-white/10 text-slate-200' },
  GPS_UNAVAILABLE: { label: 'No location', className: 'bg-slate-100 text-slate-600', light: 'bg-white/10 text-slate-300' },
  SCHEDULED: { label: 'Later', className: 'bg-slate-100 text-slate-700', light: 'bg-white/10 text-slate-200' },
  COMPLETED: { label: 'Arrived', className: 'bg-slate-100 text-slate-600', light: 'bg-white/10 text-slate-300' },
  CANCELLED: { label: 'Cancelled', className: 'bg-slate-100 text-slate-500', light: 'bg-white/10 text-slate-400' },
};

export function StatusBadge({ state, light = false }: { state: OperationalState; light?: boolean }) {
  const style = STATE_STYLE[state] ?? STATE_STYLE.SCHEDULED;
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase ${
        light ? style.light : style.className
      }`}
    >
      {style.label}
    </span>
  );
}

/**
 * ETA wording. Deterministic arithmetic from the SQL views - this is a
 * projection from distance, speed and recorded delay, not a prediction.
 */
export function formatEta(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return '--';
  if (minutes <= 1) return 'Arriving now';
  if (minutes <= 3) return 'Arriving soon';
  return `${Math.round(minutes)} min`;
}

/**
 * Delay wording. Below the 5-minute DELAYED threshold the badge still reads
 * "On time", so calling that bus "delayed" would contradict it - it is just
 * running slightly behind.
 */
export function formatDelay(minutes: number | null | undefined): string | null {
  if (!minutes || minutes < 1) return null;
  const rounded = Math.round(minutes);
  return rounded < 5
    ? `Running ${rounded} min behind schedule`
    : `Delayed by ${rounded} min`;
}
