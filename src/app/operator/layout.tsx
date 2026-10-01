import { StaffShell } from '@/components/staff-shell';
import { requireStaff } from '@/lib/auth';

/**
 * Operator area: operators and admins only. Each page and Server Action
 * repeats the check (requireStaff) because layouts do not re-run on every
 * navigation and Server Actions can be called directly.
 */
export default async function OperatorLayout({ children }: LayoutProps<'/operator'>) {
  const session = await requireStaff();
  return <StaffShell session={session}>{children}</StaffShell>;
}
