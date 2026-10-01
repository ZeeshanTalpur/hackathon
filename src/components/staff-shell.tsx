import Link from 'next/link';
import type { ReactNode } from 'react';

import { OperatorNav } from '@/app/operator/operator-nav';
import type { SessionContext } from '@/lib/auth';

/** Shared chrome for /operator and /admin: title, signed-in user, tabs. */
export function StaffShell({ session, children }: { session: SessionContext; children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-4 py-4 sm:py-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <Link href="/operator" className="text-lg font-semibold">
              Karachi Transit · Operations
            </Link>
            <p className="text-xs opacity-60">DEMO / SIMULATED hackathon data - not official transport information</p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="opacity-70">
              {session.profile?.full_name ?? session.email} · <strong>{session.role}</strong>
            </span>
            <form action="/auth/sign-out" method="post">
              <button className="rounded border border-black/20 px-2 py-1 text-xs dark:border-white/20" type="submit">
                Sign out
              </button>
            </form>
          </div>
        </div>
        <OperatorNav isAdmin={session.role === 'admin'} />
      </header>
      <main className="flex flex-col gap-4">{children}</main>
    </div>
  );
}
