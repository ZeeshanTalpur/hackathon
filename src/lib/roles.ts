import type { UserRole } from '@/lib/types/database';

/**
 * Landing route per role, used after sign-in.
 *
 * Lives here rather than in lib/auth.ts so Client Components can import it
 * without pulling in the server-only Supabase client (which uses next/headers
 * and cannot be bundled for the browser).
 */
export const ROLE_HOME: Record<UserRole, string> = {
  passenger: '/',
  driver: '/driver',
  operator: '/operator',
  admin: '/operator',
};

export const ROLES: UserRole[] = ['passenger', 'driver', 'operator', 'admin'];
