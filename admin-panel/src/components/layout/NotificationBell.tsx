'use client';

import { useState } from 'react';
import { BellRing } from 'lucide-react';
import { Button } from '@/components/core/Button';
import { useFormatTimestamp } from '@/components/layout/TimezoneProvider';
import type { QueuedNotification } from '@/lib/notification-queue';

interface NotificationBellProps {
  events: readonly QueuedNotification[];
  unread: number;
  onClear: () => void;
  onSeen: () => void;
}

/**
 * System alert bell: the critical admin actions and unusual-activity warnings the notification service
 * holds, rendered as a count and a list.
 *
 * Why the bell renders and does not listen: the service owns the connection, the dedup and the
 * alerting, so this stays the same bell whether its alerts arrive from the audit stream or from a
 * later channel.
 */
export function NotificationBell({ events, unread, onClear, onSeen }: NotificationBellProps): React.JSX.Element {
  // Why: an alert is about the running system, not about any one contest, so it has no owner zone
  // of its own and reads in the reader's.
  const formatTimestamp = useFormatTimestamp();
  const [open, setOpen] = useState(false);

  const toggle = (): void => {
    setOpen((value) => !value);
    onSeen();
  };

  return (
    <div className="relative">
      <Button variant="ghost" size="sm" iconOnly tooltip="System alerts" onClick={toggle}>
        <span className="relative flex">
          <BellRing className="size-4" />
          {unread > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-0.5 rounded-full bg-destructive text-[10px] font-bold text-white flex items-center justify-center animate-pulse">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </span>
      </Button>
      {open && (
        <div className="fixed inset-x-3 top-16 max-h-96 overflow-y-auto rounded-xl border border-border bg-card shadow-xl z-50 sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-80 sm:max-w-none">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">System alerts</span>
            <button type="button" onClick={onClear} className="text-xs text-muted-foreground hover:text-foreground">
              Clear
            </button>
          </div>
          {events.length === 0 ? (
            <p className="px-3 py-4 text-xs text-muted-foreground">No alerts yet.</p>
          ) : (
            events.map((event) => (
              <div key={event.id} className="px-3 py-2 border-b border-border/50 last:border-0">
                <p className="text-xs font-semibold text-foreground">{event.title}</p>
                <p className="text-xs text-muted-foreground break-words">{event.detail}</p>
                <p className="text-[10px] text-muted-foreground/70 font-mono">{formatTimestamp(event.timestamp)}</p>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
