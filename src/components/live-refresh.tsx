'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { createClient } from '@/lib/supabase/client';

type WatchedTable = 'bus_locations' | 'trips' | 'service_alerts';

/**
 * Keeps a server-rendered page live without duplicating its queries on the
 * client: on any Supabase Realtime change to the watched tables it calls
 * router.refresh(), which re-runs the Server Component and streams the new
 * rows in. Events are coalesced (one refresh per `minGapMs`) because a busy
 * fleet sends a GPS fix every few seconds per bus.
 *
 * A slow fallback poll also runs, because GPS *staleness* changes with the
 * clock, not with an event: a bus that stops reporting produces no event at
 * all, and the operator still needs to see it turn "GPS unavailable".
 */
export function LiveRefresh({
  tables,
  pollMs = 15000,
  minGapMs = 2000,
}: {
  tables: WatchedTable[];
  pollMs?: number;
  minGapMs?: number;
}) {
  const router = useRouter();
  const [connected, setConnected] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<number | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRun = useRef(0);
  const tableKey = tables.join(',');

  useEffect(() => {
    function refresh() {
      lastRun.current = Date.now();
      setLastRefresh(lastRun.current);
      router.refresh();
    }

    function scheduleRefresh() {
      if (pending.current) return;
      const wait = Math.max(0, minGapMs - (Date.now() - lastRun.current));
      pending.current = setTimeout(() => {
        pending.current = null;
        refresh();
      }, wait);
    }

    const supabase = createClient();
    const channel = supabase.channel(`live-refresh:${tableKey}`);
    for (const table of tableKey.split(',')) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, scheduleRefresh);
    }
    channel.subscribe((status) => setConnected(status === 'SUBSCRIBED'));

    const poll = setInterval(refresh, pollMs);

    return () => {
      clearInterval(poll);
      if (pending.current) clearTimeout(pending.current);
      pending.current = null;
      void supabase.removeChannel(channel);
    };
  }, [router, tableKey, pollMs, minGapMs]);

  return (
    <span className="inline-flex items-center gap-2 text-xs opacity-70" aria-live="polite">
      <span
        className={`inline-block h-2 w-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-amber-500'}`}
        aria-hidden
      />
      {connected ? 'Realtime connected' : `Polling every ${Math.round(pollMs / 1000)} s`}
      {lastRefresh ? ` · refreshed ${new Date(lastRefresh).toLocaleTimeString('en-GB')}` : null}
    </span>
  );
}
