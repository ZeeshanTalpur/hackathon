'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { createClient } from '@/lib/supabase/client';
import { ROLE_HOME } from '@/lib/roles';
import type { UserRole } from '@/lib/types/database';

const DEMO_ACCOUNTS: { role: UserRole; email: string; label: string }[] = [
  { role: 'driver', email: 'm.asif@demo.invalid', label: 'Demo driver' },
  { role: 'operator', email: 'ayesha.siddiqui@demo.invalid', label: 'Demo operator' },
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
    <div className="flex w-full flex-col gap-6">
      {showSignUp ? (
        <div className="grid grid-cols-2 rounded-full bg-white p-1 text-base ring-1 ring-black/10">
          <button
            className={`rounded-full px-3 py-3 ${mode === 'in' ? 'bg-[#0e1424] text-white' : 'text-slate-600'}`}
            onClick={() => setMode('in')}
            type="button"
          >
            Sign in
          </button>
          <button
            className={`rounded-full px-3 py-3 ${mode === 'up' ? 'bg-[#0e1424] text-white' : 'text-slate-600'}`}
            onClick={() => setMode('up')}
            type="button"
          >
            Sign up
          </button>
        </div>
      ) : null}

      {mode === 'up' && showSignUp ? (
        <form className="flex flex-col gap-4" onSubmit={(event) => void signUp(event)}>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-600">
            Name
            <input
              className="rounded-2xl border border-black/10 bg-white px-4 py-3.5 text-base outline-none focus:border-[#c4a265]"
              onChange={(event) => setFullName(event.target.value)}
              required
              value={fullName}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-600">
            Email
            <input
              className="rounded-2xl border border-black/10 bg-white px-4 py-3.5 text-base outline-none focus:border-[#c4a265]"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-600">
            Password
            <input
              className="rounded-2xl border border-black/10 bg-white px-4 py-3.5 text-base outline-none focus:border-[#c4a265]"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          <button
            className="rounded-2xl bg-[#0e1424] px-4 py-4 text-base font-medium text-white disabled:opacity-50"
            disabled={busy}
            type="submit"
          >
            {busy ? 'Creating account...' : 'Create driver account'}
          </button>
        </form>
      ) : (
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void signIn(email, password);
        }}
      >
        <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-600">
          Email
          <input
            className="rounded-2xl border border-black/10 bg-white px-4 py-3.5 text-base outline-none focus:border-[#c4a265]"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-600">
          Password
          <input
            className="rounded-2xl border border-black/10 bg-white px-4 py-3.5 text-base outline-none focus:border-[#c4a265]"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>

        <button
          className="rounded-2xl bg-[#0e1424] px-4 py-4 text-base font-medium text-white disabled:opacity-50"
          type="submit"
          disabled={busy}
        >
          {busy ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
      )}

      {DEMO_ACCOUNTS.filter((account) => account.role === intent).map((account) => (
        <div className="flex flex-col gap-3" key={account.email}>
          <p className="text-sm font-semibold tracking-[0.16em] text-[#9a7b3c] uppercase">Demo accounts</p>
          <button
            className="rounded-2xl bg-[#0e1424] px-3 py-4 text-base font-semibold text-white disabled:opacity-50"
            type="button"
            disabled={busy}
            onClick={() => void signIn(account.email, DEMO_PASSWORD)}
          >
            {account.label}
          </button>
        </div>
      ))}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
