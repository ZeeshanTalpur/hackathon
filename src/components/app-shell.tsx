import Link from 'next/link';
import type { ReactNode } from 'react';

import { SideNav } from '@/components/side-nav';

export function AppShell({
  title,
  bleed = false,
  children,
}: {
  title: string;
  action?: ReactNode;
  bleed?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`flex bg-[#f4f6f9] text-slate-900 ${bleed ? 'h-dvh overflow-hidden' : 'min-h-screen'}`}>
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-slate-200 bg-white px-3 py-5 md:flex">
        <Link className="px-3 text-sm font-semibold tracking-tight text-slate-900" href="/">
          Daily Transit
        </Link>
        <p className="mt-1 px-3 text-xs text-slate-400">City buses, live</p>
        <div className="mt-6">
          <SideNav />
        </div>
        <p className="mt-auto px-3 text-[11px] leading-relaxed text-slate-400">
          Demonstration timetable. Not an official city service.
        </p>
      </aside>

      <div className={`flex min-w-0 flex-1 flex-col ${bleed ? 'min-h-0' : ''}`}>
        <header className="border-b border-slate-200 bg-white">
          <div className="px-4 py-3 md:px-6">
            <p className="text-[11px] font-semibold tracking-[0.16em] text-slate-400 uppercase md:hidden">
              Daily Transit
            </p>
            <h1 className="truncate text-lg font-semibold tracking-tight md:text-xl">{title}</h1>
          </div>
          <div className="border-t border-slate-100 px-3 py-2 md:hidden">
            <SideNav mobile />
          </div>
        </header>
        <main
          className={
            bleed
              ? 'relative min-h-0 flex-1 overflow-hidden'
              : 'mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 md:px-8'
          }
        >
          {children}
        </main>
      </div>
    </div>
  );
}

export function ErrorState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="rounded-xl border border-red-200 bg-white p-4 text-sm">
      <p className="font-medium text-red-800">{title}</p>
      {detail ? <p className="mt-1 text-slate-600">{detail}</p> : null}
    </div>
  );
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
      <p className="font-medium">{title}</p>
      {detail ? <p className="mt-1 text-slate-500">{detail}</p> : null}
    </div>
  );
}

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">{label}…</div>
  );
}

export function DemoDataNotice() {
  return null;
}
