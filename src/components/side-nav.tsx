'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/', label: 'Ride', icon: 'ride' },
  { href: '/login?as=driver', label: 'Drive', icon: 'drive' },
  { href: '/login?as=operator', label: 'Desk', icon: 'desk' },
] as const;

export function SideNav({ mobile = false }: { mobile?: boolean }) {
  const path = usePathname();

  return (
    <nav className={mobile ? 'grid grid-cols-3 gap-1' : 'flex flex-col gap-1'}>
      {ITEMS.map((item) => {
        const active =
          item.label === 'Drive'
            ? path.startsWith('/driver')
            : item.label === 'Desk'
              ? path.startsWith('/operator')
              : path === '/' || path.startsWith('/track');
        return (
          <Link
            key={item.label}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm ${
              mobile ? 'justify-center' : ''
            } ${active ? 'bg-[#e8f1ff] font-medium text-[#1d4ed8]' : 'text-slate-600 hover:bg-slate-50'}`}
            href={item.href}
          >
            <Icon name={item.icon} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function Icon({ name }: { name: 'ride' | 'drive' | 'desk' }) {
  const common = 'h-4 w-4 shrink-0';
  if (name === 'ride') {
    return (
      <svg className={common} viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M8 1.5a4.5 4.5 0 0 0-4.5 4.5c0 3.2 4.5 8.5 4.5 8.5s4.5-5.3 4.5-8.5A4.5 4.5 0 0 0 8 1.5Z" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="8" cy="6" r="1.4" fill="currentColor" />
      </svg>
    );
  }
  if (name === 'drive') {
    return (
      <svg className={common} viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M2.5 10.5V7.2L4.2 4.2h7.6l1.7 3v3.3" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M2.5 8.2h11" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="5" cy="11.2" r="1.1" fill="currentColor" />
        <circle cx="11" cy="11.2" r="1.1" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg className={common} viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
