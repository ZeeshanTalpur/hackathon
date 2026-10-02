import Link from 'next/link';
import type { ReactNode } from 'react';

import { NotificationBell } from '@/components/notification-bell';
import { SideNav } from '@/components/side-nav';

export { DemoDataNotice, EmptyState, ErrorState, LoadingState } from '@/components/states';

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
    <div className={`flex bg-[#f3efe6] text-[#141820] ${bleed ? 'h-dvh overflow-hidden' : 'min-h-screen'}`}>
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-[#0e1424] px-4 py-6 text-white md:flex">
        <Link className="px-2" href="/">
          <span className="font-display block text-2xl leading-none tracking-tight">Daily</span>
          <span className="mt-1 block text-[11px] font-medium tracking-[0.28em] text-[#c4a265] uppercase">Transit</span>
        </Link>
        <div className="mt-8">
          <SideNav tone="dark" />
        </div>
        <p className="mt-auto px-2 text-[11px] leading-relaxed text-white/40">
          Demonstration timetable. Not an official city service.
        </p>
      </aside>

      <div className={`flex min-w-0 flex-1 flex-col ${bleed ? 'min-h-0' : ''}`}>
        <header className="relative z-30 border-b border-black/5 bg-[#f3efe6]/90 backdrop-blur">
          <div className="flex items-center justify-between gap-3 px-4 py-3 md:px-8">
            <div className="min-w-0">
              <p className="font-display text-lg leading-none md:hidden">Daily Transit</p>
              <h1 className="truncate text-lg font-semibold tracking-tight md:text-2xl">{title}</h1>
            </div>
            <NotificationBell />
          </div>
          <div className="px-3 pb-3 md:hidden">
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
