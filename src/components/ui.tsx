import type { ReactNode } from 'react';

import type { Tone } from '@/lib/format';

/**
 * Small presentational primitives for the staff screens. No client hooks, so
 * they render inside Server Components. Colours follow the existing
 * foreground/background tokens plus one accent per status tone.
 */

const TONE_CLASS: Record<Tone, string> = {
  neutral: 'bg-black/5 text-black/70 dark:bg-white/10 dark:text-white/70',
  good: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  warn: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  bad: 'bg-red-500/15 text-red-700 dark:text-red-300',
  info: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}

export function Card({ title, actions, children, className = '' }: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`min-w-0 max-w-full rounded-lg border border-black/10 bg-background dark:border-white/15 ${className}`}>
      {title || actions ? (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-black/10 px-4 py-3 dark:border-white/15">
          {title ? <h2 className="text-sm font-semibold">{title}</h2> : <span />}
          {actions}
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function StatCard({ label, value, hint, tone = 'neutral' }: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
}) {
  const accent = tone === 'neutral' ? '' : TONE_CLASS[tone].split(' ').filter((c) => c.startsWith('text-') || c.startsWith('dark:text-')).join(' ');
  return (
    <div className="rounded-lg border border-black/10 p-4 dark:border-white/15">
      <p className="text-xs uppercase tracking-wide opacity-60">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${accent}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs opacity-60">{hint}</p> : null}
    </div>
  );
}

/** Horizontally scrollable table wrapper so wide tables stay usable on phones. */
export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-full overflow-x-auto overscroll-x-contain">
      <table className="w-full min-w-[40rem] border-collapse text-left text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`border-b border-black/10 px-2 py-2 text-xs font-medium uppercase tracking-wide opacity-60 dark:border-white/15 ${className}`}>{children}</th>;
}

export function Td({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <td className={`border-b border-black/5 px-2 py-2 align-top dark:border-white/10 ${className}`}>{children}</td>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm opacity-60">{children}</p>;
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p className="rounded border border-red-500/40 bg-red-500/5 p-3 text-sm text-red-700 dark:text-red-300">
      Could not load data: {message}
    </p>
  );
}

export function RouteChip({ code, color }: { code: string | null; color: string | null }) {
  if (!code) return <span className="opacity-50">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-medium">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color ?? '#888' }} aria-hidden />
      {code}
    </span>
  );
}

export const buttonClass =
  'inline-flex items-center justify-center rounded border border-black/20 px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10';

export const primaryButtonClass =
  'inline-flex items-center justify-center rounded bg-foreground px-3 py-1.5 text-sm text-background hover:opacity-90 disabled:opacity-50';

export const inputClass =
  'rounded border border-black/20 bg-background px-2 py-1.5 text-sm dark:border-white/20';
