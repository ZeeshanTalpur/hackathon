'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/operator', label: 'Live' },
  { href: '/operator/trips', label: 'Trips' },
  { href: '/operator/buses', label: 'Buses' },
  { href: '/operator/routes', label: 'Routes' },
  { href: '/operator/drivers', label: 'Drivers' },
  { href: '/operator/alerts', label: 'Alerts' },
  { href: '/operator/analytics', label: 'Analytics' },
];

/** Tab bar; scrolls horizontally on narrow screens instead of wrapping. */
export function OperatorNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const links = isAdmin ? [...LINKS, { href: '/admin', label: 'Admin' }] : LINKS;

  return (
    <nav aria-label="Operator sections">
      <ul className="flex flex-wrap gap-1">
        {links.map((link) => {
          const active = link.href === '/operator' ? pathname === '/operator' : pathname.startsWith(link.href);
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={`block rounded-full px-3 py-1.5 text-sm ${
                  active ? 'bg-[#c4a265] font-semibold text-[#0e1424]' : 'text-white/70 hover:bg-white/10 hover:text-white'
                }`}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
