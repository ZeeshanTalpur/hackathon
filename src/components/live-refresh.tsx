'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { createClient } from '@/lib/supabase/client';

type WatchedTable = 'bus_locations' | 'trips' | 'service_alerts';

/**
 * Keeps a server-rendered page live. Realtime changes call router.refresh(),
 * coalesced so a burst of GPS rows does not rebuild the page every couple of
 * seconds. The interval only runs while realtime is down.
 */
export function LiveRefresh({
  tables,
  pollMs = 30000,
  minGapMs = 8000,
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
  const refresh = useRef(() => {});
  const tableKey = tables.join(',');

  refresh.current = () => {
    lastRun.current = Date.now();
    setLastRefresh(lastRun.current);
    router.refresh();
  };

  useEffect(() => {
    function scheduleRefresh() {
      if (pending.current) return;
      const wait = Math.max(0, minGapMs - (Date.now() - lastRun.current));
      pending.current = setTimeout(() => {
        pending.current = null;
        refresh.current();
      }, wait);
    }

    const supabase = createClient();
    const channel = supabase.channel(`live-refresh:${tableKey}`);
    for (const table of tableKey.split(',')) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, scheduleRefresh);
    }
    channel.subscribe((status) => setConnected(status === 'SUBSCRIBED'));

    return () => {
      if (pending.current) clearTimeout(pending.current);
      pending.current = null;
      void supabase.removeChannel(channel);
    };
  }, [tableKey, minGapMs]);

  useEffect(() => {
    if (connected) return;
    const poll = setInterval(() => refresh.current(), pollMs);
    return () => clearInterval(poll);
  }, [connected, pollMs]);

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
