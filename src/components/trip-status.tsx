import type { OperationalState } from '@/lib/types/database';

const STATE_STYLE: Record<OperationalState, { label: string; className: string }> = {
  ON_TIME: { label: 'On time', className: 'bg-green-600/15 text-green-700 dark:text-green-400' },
  DELAYED: { label: 'Delayed', className: 'bg-amber-600/15 text-amber-700 dark:text-amber-400' },
  STOPPED: { label: 'Stopped', className: 'bg-slate-600/15 text-slate-700 dark:text-slate-300' },
  GPS_UNAVAILABLE: {
    label: 'Location unavailable',
    className: 'bg-red-600/15 text-red-700 dark:text-red-400',
  },
  SCHEDULED: { label: 'Scheduled', className: 'bg-blue-600/15 text-blue-700 dark:text-blue-400' },
  COMPLETED: { label: 'Completed', className: 'bg-slate-600/15 text-slate-700 dark:text-slate-300' },
  CANCELLED: { label: 'Cancelled', className: 'bg-red-600/15 text-red-700 dark:text-red-400' },
};

export function StatusBadge({ state }: { state: OperationalState }) {
  const { label, className } = STATE_STYLE[state] ?? STATE_STYLE.SCHEDULED;
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}>
      {label}
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

export function formatDelay(minutes: number | null | undefined): string | null {
  if (!minutes || minutes < 1) return null;
  return `Delayed by ${Math.round(minutes)} min`;
}
