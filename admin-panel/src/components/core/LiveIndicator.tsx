'use client';

import { useDictionary } from '@/hooks/useDictionary';
import { cn } from '@/lib/utils';
import type { LiveStatus } from '@/hooks/useLiveStream';

const STATUS_STYLES: Record<LiveStatus, string> = {
  live: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  connecting: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  reconnecting: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  paused: 'text-muted-foreground bg-muted/40 border-border',
};

const DOT_STYLES: Record<LiveStatus, string> = {
  live: 'bg-emerald-400',
  connecting: 'bg-amber-400 animate-pulse',
  reconnecting: 'bg-amber-400 animate-pulse',
  paused: 'bg-muted-foreground',
};

/**
 * Shows whether the page's push channel is up.
 *
 * Why it exists: the pollers this replaced failed loudly — a toast, or a card that simply never
 * filled. A stream that dies quietly would look like data that stopped changing, so the connection's
 * own state is on screen, and the last snapshot stays visible underneath it while it reconnects.
 */
export function LiveIndicator({ status, className }: { status: LiveStatus; className?: string }): React.JSX.Element {
  const dictionary = useDictionary();
  const labels: Record<LiveStatus, string> = {
    live: dictionary.live.connected,
    connecting: dictionary.live.connecting,
    reconnecting: dictionary.live.reconnecting,
    paused: dictionary.live.paused,
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-1 border rounded-full text-xs font-bold uppercase tracking-wider',
        STATUS_STYLES[status],
        className
      )}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full', DOT_STYLES[status])} />
      {labels[status]}
    </span>
  );
}
