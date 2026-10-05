'use client';

import { useDictionary } from '@/hooks/useDictionary';
import { cn } from '@/lib/utils';
import type { LiveStatus } from '@/hooks/useLiveStream';

const STATUS_STYLES: Record<LiveStatus, string> = {
  live: 'text-success bg-success/10 border-success/20 high-contrast:bg-success high-contrast:text-success-foreground high-contrast:border-success',
  connecting: 'text-warning bg-warning/10 border-warning/20 high-contrast:bg-warning high-contrast:text-warning-foreground high-contrast:border-warning',
  reconnecting: 'text-warning bg-warning/10 border-warning/20 high-contrast:bg-warning high-contrast:text-warning-foreground high-contrast:border-warning',
  paused: 'text-muted-foreground bg-muted/40 border-border high-contrast:text-foreground',
};

const DOT_STYLES: Record<LiveStatus, string> = {
  live: 'bg-success high-contrast:bg-success-foreground',
  connecting: 'bg-warning animate-pulse high-contrast:bg-warning-foreground',
  reconnecting: 'bg-warning animate-pulse high-contrast:bg-warning-foreground',
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
