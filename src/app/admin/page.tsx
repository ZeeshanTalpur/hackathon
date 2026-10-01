import Link from 'next/link';

import { ActiveTripsTable } from '@/app/operator/active-trips-table';
import { Badge, Card, Empty, ErrorNote, StatCard, TableWrap, Td, Th } from '@/components/ui';
import { requireRole } from '@/lib/auth';
import { loadLiveTrips, loadOverview, loadProfiles, loadReference } from '@/lib/operator/queries';
import { ROLES } from '@/lib/roles';
import { createClient } from '@/lib/supabase/server';
import type { UserRole } from '@/lib/types/database';

export const metadata = { title: 'Admin · Karachi Transit' };

const ROLE_TONE = { passenger: 'neutral', driver: 'info', operator: 'warn', admin: 'bad' } as const;

export default async function AdminPage() {
  await requireRole(['admin']);
  const supabase = await createClient();
  const [{ overview, error: overviewError }, { profiles, error: profilesError }, ref, live] = await Promise.all([
    loadOverview(supabase),
    loadProfiles(supabase),
    loadReference(supabase),
    loadLiveTrips(supabase),
  ]);

  const byRole = (role: UserRole) => profiles.filter((p) => p.role === role).length;
  const error = overviewError ?? profilesError ?? ref.error ?? live.error;

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold">Admin</h1>
        <p className="text-sm opacity-70">System overview, users and roles. Operational tools live in the operator tabs.</p>
      </div>

      {error ? <ErrorNote message={error} /> : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Users" value={profiles.length} hint={ROLES.map((r) => `${byRole(r)} ${r}`).join(' · ')} />
        <StatCard label="Buses" value={ref.buses.length} hint={`${overview?.active_buses ?? 0} active`} />
        <StatCard label="Drivers" value={ref.drivers.length} hint={`${ref.drivers.filter((d) => d.status === 'active').length} on duty`} />
        <StatCard label="Routes" value={ref.routes.length} hint={`${ref.routes.filter((r) => r.is_active).length} active`} />
        <StatCard label="Active trips" value={live.trips.length} hint={`${live.trips.filter((t) => t.is_delayed).length} delayed`} />
        <StatCard label="Active alerts" value={overview?.active_alerts ?? 0} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={`Users & roles (${profiles.length})`} className="lg:col-span-2">
          {profiles.length === 0 ? (
            <Empty>No profiles visible.</Empty>
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Email</Th>
                  <Th>Role</Th>
                  <Th>Login linked</Th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((p) => (
                  <tr key={p.id}>
                    <Td className="font-medium">{p.full_name}</Td>
                    <Td className="text-xs">{p.email ?? '—'}</Td>
                    <Td><Badge tone={ROLE_TONE[p.role]}>{p.role}</Badge></Td>
                    <Td className="text-xs">{p.auth_user_id ? 'Yes' : 'No (seed profile only)'}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
          <p className="mt-3 text-xs opacity-60">
            Read-only. Roles come from <code>profiles.role</code>; RLS lets users edit only their own profile, so role
            changes are made in Supabase (SQL editor or a service-role script), never from the browser.
          </p>
        </Card>

        <Card title="Management">
          <ul className="flex flex-col gap-2 text-sm">
            <li><Link className="underline" href="/operator">Live operations</Link> - buses, delays, GPS</li>
            <li><Link className="underline" href="/operator/buses">Buses</Link> - status, driver assignment, add bus</li>
            <li><Link className="underline" href="/operator/drivers">Drivers</Link> - duty status, current trip</li>
            <li><Link className="underline" href="/operator/routes">Routes &amp; stops</Link> - stop order, suspend/activate</li>
            <li><Link className="underline" href="/operator/alerts">Service alerts</Link> - publish to passengers</li>
            <li><Link className="underline" href="/operator/analytics">Analytics</Link></li>
            <li><Link className="underline" href="/api/health">System health check</Link></li>
          </ul>
        </Card>
      </div>

      <Card title={`Active trips (${live.trips.length})`}>
        {live.trips.length ? <ActiveTripsTable trips={live.trips} /> : <Empty>No trips are in progress.</Empty>}
      </Card>
    </>
  );
}
