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
    <main className="flex min-h-screen items-center justify-center bg-[#f4f6f9] px-4 py-10">
      <div className="flex w-full max-w-md flex-col gap-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-8">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold tracking-[0.16em] text-[#2563eb] uppercase">Daily Transit</p>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm leading-6 text-slate-500">
            {intent === 'driver'
              ? 'Sign in to start a run and share location.'
              : intent === 'operator'
                ? 'Sign in to watch the fleet, delays, and announcements.'
                : 'Choose who you are for this demonstration.'}
          </p>
        </div>

        {sameDesk && session ? (
          <div className="flex items-center justify-between gap-3 text-sm text-slate-500">
            <p>Signed in as {session.profile?.full_name ?? session.email}.</p>
            <form action="/auth/sign-out" method="post">
              <button className="font-medium text-[#2563eb]" type="submit">
                Sign out
              </button>
            </form>
          </div>
        ) : null}

        <LoginForm intent={intent} />
      </div>
    </main>
  );
}
