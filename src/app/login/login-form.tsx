'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

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

export function LoginForm({ intent = 'ride' }: { intent?: 'ride' | 'driver' | 'operator' }) {
  const router = useRouter();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const showSignUp = intent === 'driver';

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

  async function signUp(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const response = await fetch('/api/sign-up', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName, email, password }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(body.error ?? 'Could not create the account.');
      setBusy(false);
      return;
    }

    await signIn(email, password);
  }

  return (
    <div className="flex w-full flex-col gap-5">
      {showSignUp ? (
        <div className="grid grid-cols-2 rounded-full bg-white p-1 text-sm ring-1 ring-slate-200">
          <button
            className={`rounded-full px-3 py-2 ${mode === 'in' ? 'bg-[#2563eb] text-white' : 'text-slate-600'}`}
            onClick={() => setMode('in')}
            type="button"
          >
            Sign in
          </button>
          <button
            className={`rounded-full px-3 py-2 ${mode === 'up' ? 'bg-[#2563eb] text-white' : 'text-slate-600'}`}
            onClick={() => setMode('up')}
            type="button"
          >
            Sign up
          </button>
        </div>
      ) : null}

      {mode === 'up' && showSignUp ? (
        <form className="flex flex-col gap-3" onSubmit={(event) => void signUp(event)}>
          <label className="flex flex-col gap-1 text-sm">
            Name
            <input
              className="rounded-xl border border-slate-200 bg-white px-3 py-2.5"
              onChange={(event) => setFullName(event.target.value)}
              required
              value={fullName}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Email
            <input
              className="rounded-xl border border-slate-200 bg-white px-3 py-2.5"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Password
            <input
              className="rounded-xl border border-slate-200 bg-white px-3 py-2.5"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          <button
            className="rounded-2xl bg-[#2563eb] px-3 py-3 text-sm font-medium text-white disabled:opacity-50"
            disabled={busy}
            type="submit"
          >
            {busy ? 'Creating account...' : 'Create driver account'}
          </button>
        </form>
      ) : (
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
            className="rounded-xl border border-slate-200 bg-white px-3 py-2.5"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Password
          <input
            className="rounded-xl border border-slate-200 bg-white px-3 py-2.5"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>

        <button
          className="rounded-2xl bg-[#2563eb] px-3 py-3 text-sm font-medium text-white disabled:opacity-50"
          type="submit"
          disabled={busy}
        >
          {busy ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-sm text-slate-500">Continue as</p>
        <div className="grid grid-cols-2 gap-2">
          {DEMO_ACCOUNTS.map((account) => {
            const highlighted =
              (intent === 'driver' && account.role === 'driver') ||
              (intent === 'operator' && (account.role === 'operator' || account.role === 'admin'));
            return (
              <button
                key={account.email}
                className={`rounded-2xl px-3 py-3 text-sm disabled:opacity-50 ${
                  highlighted
                    ? 'bg-[#2563eb] font-medium text-white'
                    : 'bg-white ring-1 ring-slate-200'
                }`}
                type="button"
                disabled={busy}
                onClick={() => void signIn(account.email, DEMO_PASSWORD)}
              >
                {account.label}
              </button>
            );
          })}
        </div>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
