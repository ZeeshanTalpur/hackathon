'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import { ROLE_HOME } from '@/lib/roles';
import type { UserRole } from '@/lib/types/database';

const DEMO_ACCOUNTS: { role: UserRole; email: string; label: string }[] = [
  { role: 'passenger', email: 'sana.fatima@demo.invalid', label: 'Passenger' },
  { role: 'driver', email: 'm.asif@demo.invalid', label: 'Driver' },
  { role: 'operator', email: 'ayesha.siddiqui@demo.invalid', label: 'Operator' },
  { role: 'admin', email: 'hamza.qureshi@demo.invalid', label: 'Admin' },
];

const DEMO_PASSWORD = 'demo-transit-2026';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn(withEmail: string, withPassword: string) {
    setBusy(true);
    setError(null);

    const supabase = createClient();
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: withEmail,
      password: withPassword,
    });

    if (signInError) {
      setError(signInError.message);
      setBusy(false);
      return;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('auth_user_id', data.user.id)
      .maybeSingle();

    router.push(ROLE_HOME[profile?.role ?? 'passenger']);
    router.refresh();
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-6">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void signIn(email, password);
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input
            className="rounded border border-black/20 px-3 py-2 dark:border-white/20"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Password
          <input
            className="rounded border border-black/20 px-3 py-2 dark:border-white/20"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>

        <button
          className="rounded bg-foreground px-3 py-2 text-background disabled:opacity-50"
          type="submit"
          disabled={busy}
        >
          {busy ? 'Signing in...' : 'Sign in'}
        </button>
      </form>

      <div className="flex flex-col gap-2">
        <p className="text-sm opacity-70">Demo accounts (run scripts/seed-auth.mjs first)</p>
        <div className="grid grid-cols-2 gap-2">
          {DEMO_ACCOUNTS.map((account) => (
            <button
              key={account.email}
              className="rounded border border-black/20 px-3 py-2 text-sm disabled:opacity-50 dark:border-white/20"
              type="button"
              disabled={busy}
              onClick={() => void signIn(account.email, DEMO_PASSWORD)}
            >
              {account.label}
            </button>
          ))}
        </div>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
