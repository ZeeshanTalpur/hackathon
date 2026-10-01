import { StaffShell } from '@/components/staff-shell';
import { requireRole } from '@/lib/auth';

/** Admin area: admins only (operators are redirected home). */
export default async function AdminLayout({ children }: LayoutProps<'/admin'>) {
  const session = await requireRole(['admin']);
  return <StaffShell session={session}>{children}</StaffShell>;
}
