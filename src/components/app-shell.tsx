import Link from 'next/link';
import type { ReactNode } from 'react';

/** Page frame. Mobile-first: single column, large tap targets, no fixed widths. */
export function AppShell({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <Link className="text-xs uppercase tracking-wide opacity-60" href="/">
            Karachi Transit
          </Link>
          <h1 className="text-lg font-semibold sm:text-xl">{title}</h1>
        </div>
        <nav className="flex items-center gap-3 text-xs">
          <Link className="underline opacity-70" href="/">
            Passenger
          </Link>
          <Link className="underline opacity-70" href="/driver">
            Driver
          </Link>
          <Link className="underline opacity-70" href="/operator">
            Operator
          </Link>
          {action}
        </nav>
      </header>
      {children}
    </div>
  );
}

export function ErrorState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="rounded border border-red-500/50 bg-red-500/5 p-4 text-sm">
      <p className="font-medium">{title}</p>
      {detail ? <p className="mt-1 opacity-80">{detail}</p> : null}
    </div>
  );
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="rounded border border-black/15 p-4 text-sm dark:border-white/15">
      <p className="font-medium">{title}</p>
      {detail ? <p className="mt-1 opacity-70">{detail}</p> : null}
    </div>
  );
}

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="rounded border border-black/15 p-4 text-sm opacity-70 dark:border-white/15">
      {label}...
    </div>
  );
}

export function DemoDataNotice() {
  return (
    <p className="mt-2 text-xs opacity-60">
      DEMO / SIMULATED HACKATHON DATA. Routes, schedules, fares, buses and driver records are
      invented for this demonstration and are not official Karachi public transport information.
      Stop coordinates reference real locations so the map renders correctly.
    </p>
  );
}
