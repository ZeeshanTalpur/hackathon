'use client';

import { useEffect, useState } from 'react';

import { timeAgo } from '@/lib/format';

/**
 * "12 s ago" that keeps ticking between server refreshes. The server render
 * and the first client render can differ by a second, hence
 * suppressHydrationWarning on the text node.
 */
export function TimeAgo({ iso, staleAfterSec }: { iso: string | null; staleAfterSec?: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  const stale =
    staleAfterSec !== undefined && iso !== null && (now - new Date(iso).getTime()) / 1000 > staleAfterSec;

  return (
    <time
      dateTime={iso ?? undefined}
      className={stale ? 'font-medium text-red-700 dark:text-red-300' : undefined}
      suppressHydrationWarning
    >
      {timeAgo(iso, now)}
    </time>
  );
}
