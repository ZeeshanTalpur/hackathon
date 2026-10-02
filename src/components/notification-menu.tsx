'use client';

import { useEffect, useId, useRef, useState } from 'react';

export type NoticeItem = {
  id: string;
  title: string;
  body: string;
  tone: 'info' | 'warning' | 'critical';
};

const TONE = {
  info: 'border-l-[#3d6ea8]',
  warning: 'border-l-[#c4a265]',
  critical: 'border-l-[#b42318]',
} as const;

export function NotificationMenu({
  items,
  tone = 'light',
}: {
  items: NoticeItem[];
  tone?: 'light' | 'dark';
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;

    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const count = items.length;

  return (
    <div className="relative" ref={rootRef}>
      <button
        aria-controls={panelId}
        aria-expanded={open}
        aria-label={count > 0 ? `Notifications, ${count}` : 'Notifications'}
        className={`relative grid h-11 w-11 place-items-center rounded-2xl ${
          tone === 'dark' ? 'text-white hover:bg-white/10' : 'text-[#0e1424] hover:bg-white'
        }`}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <BellIcon />
        {count > 0 ? (
          <span className="absolute top-1.5 right-1.5 grid min-w-4 place-items-center rounded-full bg-[#c4a265] px-1 text-[10px] font-bold text-[#0e1424]">
            {count > 9 ? '9+' : count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          aria-label="Notifications"
          className="absolute right-0 z-50 mt-2 w-[min(28rem,calc(100vw-1.5rem))] overflow-hidden rounded-3xl bg-white text-[#141820] shadow-[0_24px_60px_-24px_rgba(14,20,36,0.55)] ring-1 ring-black/10"
          id={panelId}
          role="dialog"
        >
          <div className="flex items-center justify-between gap-4 border-b border-black/5 px-5 py-4">
            <h2 className="font-display text-2xl leading-none">Notifications</h2>
            <button className="text-sm font-medium text-slate-500" onClick={() => setOpen(false)} type="button">
              Close
            </button>
          </div>
          {items.length === 0 ? (
            <p className="px-5 py-8 text-base leading-7 text-slate-600">No notifications right now.</p>
          ) : (
            <ul className="max-h-[min(32rem,70vh)] overflow-auto">
              {items.map((item) => (
                <li
                  className={`border-b border-black/5 border-l-4 px-5 py-4 last:border-b-0 ${TONE[item.tone]}`}
                  key={item.id}
                >
                  <p className="text-base font-semibold leading-snug">{item.title}</p>
                  <p className="mt-1.5 text-[15px] leading-6 text-slate-600">{item.body}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function BellIcon() {
  return (
    <svg aria-hidden className="h-5 w-5" fill="none" viewBox="0 0 20 20">
      <path
        d="M10 2.5a5 5 0 0 0-5 5v2.2c0 .7-.2 1.3-.7 1.8L3.2 13a1 1 0 0 0 .8 1.6h12a1 1 0 0 0 .8-1.6l-1.1-1.5c-.5-.5-.7-1.1-.7-1.8V7.5a5 5 0 0 0-5-5Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M8 15.2a2 2 0 0 0 4 0" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
    </svg>
  );
}
