import Link from 'next/link';

import { getSessionContext } from '@/lib/auth';
import { SUPABASE_CONFIGURED } from '@/lib/data/transit';

import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

interface LoginPageProps {
  searchParams: Promise<{ as?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { as } = await searchParams;
  const intent = as === 'operator' || as === 'admin' ? 'operator' : as === 'driver' ? 'driver' : 'ride';
  const session = SUPABASE_CONFIGURED ? await getSessionContext() : null;
  const sameDesk =
    session &&
    ((intent === 'driver' && session.role === 'driver') ||
      (intent === 'operator' && (session.role === 'operator' || session.role === 'admin')) ||
      (intent === 'ride' && session.role === 'passenger'));

  const title =
    intent === 'driver' ? 'Driver sign in' : intent === 'operator' ? 'Operator sign in' : 'Sign in';

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0e1424] px-4 py-8 sm:px-8">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-[2rem] bg-white shadow-[0_40px_80px_-32px_rgba(0,0,0,0.65)] lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <section className="hidden flex-col justify-between gap-10 bg-[#141b2e] p-8 text-white sm:p-10 lg:flex">
          <Link href="/">
            <span className="font-display block text-4xl leading-none">Daily</span>
            <span className="mt-2 block text-xs font-medium tracking-[0.28em] text-[#c4a265] uppercase">Transit</span>
          </Link>
          <div>
            <p className="font-display text-4xl leading-[1.05] sm:text-5xl">The city, on a live map.</p>
            <p className="mt-4 max-w-sm text-base leading-7 text-white/65">
              Drivers share a position. Riders follow the bus. The desk watches the whole fleet.
            </p>
          </div>
          <p className="text-xs text-white/35">Demonstration timetable. Not an official city service.</p>
        </section>

        <section className="flex flex-col justify-center bg-[#f7f4ee] px-6 py-10 sm:px-10 sm:py-12">
          <nav className="mb-8 grid grid-cols-2 gap-2" aria-label="Switch section">
            {intent !== 'ride' ? (
              <Link
                className="rounded-2xl bg-white px-3 py-3 text-center text-sm font-semibold text-[#0e1424] ring-1 ring-black/10"
                href="/"
              >
                Passenger
              </Link>
            ) : null}
            {intent !== 'driver' ? (
              <Link
                className="rounded-2xl bg-white px-3 py-3 text-center text-sm font-semibold text-[#0e1424] ring-1 ring-black/10"
                href="/login?as=driver"
              >
                Driver
              </Link>
            ) : null}
            {intent !== 'operator' ? (
              <Link
                className="rounded-2xl bg-white px-3 py-3 text-center text-sm font-semibold text-[#0e1424] ring-1 ring-black/10"
                href="/login?as=operator"
              >
                Operator
              </Link>
            ) : null}
          </nav>
          <Link className="mb-8 lg:hidden" href="/">
            <span className="font-display text-3xl leading-none text-[#0e1424]">Daily</span>
            <span className="mt-1 block text-[11px] font-medium tracking-[0.28em] text-[#9a7b3c] uppercase">Transit</span>
          </Link>
          <div className="flex flex-col gap-2">
            <h1 className="font-display text-4xl leading-none sm:text-5xl">{title}</h1>
            <p className="mt-2 text-base leading-7 text-slate-600">
              {intent === 'driver'
                ? 'Sign in to start a run and share location.'
                : intent === 'operator'
                  ? 'Sign in to watch the fleet, delays, and announcements.'
                  : 'Choose who you are for this demonstration.'}
            </p>
          </div>

          {sameDesk && session ? (
            <div className="mt-6 flex items-center justify-between gap-3 text-sm text-slate-500">
              <p>Signed in as {session.profile?.full_name ?? session.email}.</p>
              <form action="/auth/sign-out" method="post">
                <button className="font-medium text-[#0e1424]" type="submit">
                  Sign out
                </button>
              </form>
            </div>
          ) : null}

          <div className="mt-8">
            <LoginForm intent={intent} />
          </div>
        </section>
      </div>
    </main>
  );
}
