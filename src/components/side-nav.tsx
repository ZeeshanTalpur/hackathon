'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/', label: 'Ride', hint: 'Find a bus', icon: 'ride' },
  { href: '/login?as=driver', label: 'Drive', hint: 'Share location', icon: 'drive' },
  { href: '/login?as=operator', label: 'Desk', hint: 'Watch the fleet', icon: 'desk' },
] as const;

export function SideNav({ mobile = false, tone = 'light' }: { mobile?: boolean; tone?: 'light' | 'dark' }) {
  const path = usePathname();
  const dark = tone === 'dark';

  return (
    <nav className={mobile ? 'grid grid-cols-3 gap-1' : 'flex flex-col gap-1'} aria-label="Main">
      {ITEMS.map((item) => {
        const active =
          item.label === 'Drive'
            ? path.startsWith('/driver')
            : item.label === 'Desk'
              ? path.startsWith('/operator') || path.startsWith('/admin')
              : path === '/' || path.startsWith('/track');
        return (
          <Link
            key={item.label}
            className={`flex min-w-0 items-center gap-2 rounded-2xl px-2 py-2 text-sm transition sm:gap-3 sm:px-3 sm:py-2.5 ${
              mobile ? 'justify-center' : ''
            } ${
              active
                ? dark
                  ? 'bg-white/10 text-white'
                  : 'bg-[#0e1424] text-white'
                : dark
                  ? 'text-white/70 hover:bg-white/5 hover:text-white'
                  : 'text-slate-600 hover:bg-white'
            }`}
            href={item.href}
          >
            <span
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl ${
                active ? (dark ? 'bg-[#c4a265] text-[#0e1424]' : 'bg-[#c4a265] text-[#0e1424]') : dark ? 'bg-white/10 text-white/80' : 'bg-[#f3efe6] text-[#0e1424]'
              }`}
            >
              <Icon name={item.icon} />
            </span>
            <span className="min-w-0">
              <span className="block truncate font-medium leading-none">{item.label}</span>
              {mobile ? null : (
                <span className={`mt-1 block text-[11px] ${active && !dark ? 'text-white/60' : dark ? 'text-white/40' : 'text-slate-400'}`}>
                  {item.hint}
                </span>
              )}
            </span>
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
