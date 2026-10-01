import Link from 'next/link';

import { getSessionContext } from '@/lib/auth';

const SUPABASE_CONFIGURED = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

export default async function Home() {
  // Guarded so the app still builds and renders before Supabase is configured.
  const session = SUPABASE_CONFIGURED ? await getSessionContext() : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Karachi Transit</h1>
        <p className="text-sm opacity-70">
          Smart public transport &amp; bus tracking. All transport data is DEMO / SIMULATED
          hackathon data and does not represent real Karachi public transport.
        </p>
      </header>

      {!SUPABASE_CONFIGURED ? (
        <section className="rounded border border-amber-500/50 p-4 text-sm">
          <p className="font-medium">Supabase is not configured.</p>
          <p className="opacity-70">
            Copy <code>.env.example</code> to <code>.env.local</code> and fill in the project URL
            and anon key, then restart the dev server.
          </p>
        </section>
      ) : session ? (
        <section className="flex flex-col gap-3 rounded border border-black/15 p-4 text-sm dark:border-white/15">
          <div>
            <p className="font-medium">{session.profile?.full_name ?? session.email}</p>
            <p className="opacity-70">
              Signed in as <strong>{session.role}</strong>
            </p>
          </div>
          <form action="/auth/sign-out" method="post">
            <button className="rounded border border-black/20 px-3 py-1.5 dark:border-white/20" type="submit">
              Sign out
            </button>
          </form>
        </section>
      ) : (
        <section className="rounded border border-black/15 p-4 text-sm dark:border-white/15">
          <p className="opacity-70">Not signed in.</p>
          <Link className="underline" href="/login">
            Go to sign in
          </Link>
        </section>
      )}

      <section className="flex flex-col gap-2 text-sm">
        <h2 className="font-medium">Foundation</h2>
        <ul className="flex flex-col gap-1 opacity-80">
          <li>
            <Link className="underline" href="/api/health">
              /api/health
            </Link>{' '}
            - checks env, Supabase connection, schema and seed
          </li>
          <li>Next phase: passenger route search, driver trip + GPS, operator monitoring, map</li>
        </ul>
      </section>
    </main>
  );
}
