import Link from 'next/link';
import { Suspense, type ReactNode } from 'react';

import { OperatorNav } from '@/app/operator/operator-nav';
import { NotificationBell } from '@/components/notification-bell';
import type { SessionContext } from '@/lib/auth';

/** Shared chrome for /operator and /admin: title, signed-in user, tabs. */
export function StaffShell({ session, children }: { session: SessionContext; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f3efe6] text-[#141820]">
      <header className="relative z-30 border-b border-black/5 bg-[#0e1424] pt-[env(safe-area-inset-top)] text-white">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
          <Link className="min-w-0" href="/operator">
            <span className="font-display text-2xl leading-none">Daily</span>
            <span className="ml-2 hidden text-[11px] font-medium tracking-[0.22em] text-[#c4a265] uppercase min-[420px]:inline">Operations</span>
          </Link>
          <div className="flex min-w-0 items-center gap-2 text-sm sm:gap-3">
            <Suspense fallback={<span aria-hidden className="inline-block h-11 w-11 shrink-0 rounded-2xl bg-white/10" />}>
              <NotificationBell tone="dark" />
            </Suspense>
            <span className="hidden min-w-0 truncate text-white/70 sm:inline">
              {session.profile?.full_name ?? session.email}
              <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-[11px] tracking-wide uppercase">{session.role}</span>
            </span>
            <form action="/auth/sign-out" method="post">
              <button className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-[#0e1424]" type="submit">
                Sign out
              </button>
            </form>
          </div>
        </div>
        <div className="mx-auto w-full max-w-7xl px-4 pb-3 sm:px-6">
          <OperatorNav isAdmin={session.role === 'admin'} />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-4 px-4 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-6">{children}</main>
    </div>
  );
}
