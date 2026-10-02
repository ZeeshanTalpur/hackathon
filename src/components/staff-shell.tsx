import Link from 'next/link';
import type { ReactNode } from 'react';

import { OperatorNav } from '@/app/operator/operator-nav';
import { NotificationBell } from '@/components/notification-bell';
import type { SessionContext } from '@/lib/auth';

/** Shared chrome for /operator and /admin: title, signed-in user, tabs. */
export function StaffShell({ session, children }: { session: SessionContext; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f3efe6] text-[#141820]">
      <header className="relative z-30 border-b border-black/5 bg-[#0e1424] text-white">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Link href="/operator">
            <span className="font-display text-2xl leading-none">Daily</span>
            <span className="ml-2 text-[11px] font-medium tracking-[0.22em] text-[#c4a265] uppercase">Operations</span>
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <NotificationBell tone="dark" />
            <span className="text-white/70">
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
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
