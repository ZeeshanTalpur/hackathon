import 'server-only';

import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import type { Profile, UserRole } from '@/lib/types/database';

export interface SessionContext {
  userId: string;
  email: string | null;
  profile: Profile | null;
  /** Falls back to 'passenger' when no profile row exists yet. */
  role: UserRole;
}

/**
 * Current user plus their role, for Server Components and Route Handlers.
 * Returns null when nobody is signed in.
 *
 * Uses getUser() rather than getSession() because getUser() revalidates the
 * JWT against Supabase instead of trusting the cookie.
 */
export async function getSessionContext(): Promise<SessionContext | null> {
  const supabase = await createClient();

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  return {
    userId: user.id,
    email: user.email ?? null,
    profile: profile ?? null,
    role: profile?.role ?? 'passenger',
  };
}

/**
 * Gate a page or handler on one or more roles. Redirects instead of throwing,
 * so it can be called at the top of a Server Component.
 */
export async function requireRole(allowed: UserRole[]): Promise<SessionContext> {
  const session = await getSessionContext();
  const as = allowed[0];

  // A missing or wrong role goes to sign-in for that role. It must not fall
  // through to passenger search, or the operator desk looks like the ride page.
  if (!session || !allowed.includes(session.role)) redirect(`/login?as=${as}`);

  return session;
}
