'use client';

import { useState } from 'react';
import { BellRing } from 'lucide-react';
import { Button } from '@/components/core/Button';
import { NotificationPopup } from './NotificationPopup';
import type { QueuedNotification } from '@/lib/notification-queue';

interface NotificationBellProps {
  events: readonly QueuedNotification[];
  unread: number;
  onClear: () => void;
  onSeen: () => void;
}

/**
 * System alert bell: the critical admin actions and unusual-activity warnings the notification service
 * holds, rendered as a count over its own panel.
 *
 * Why the bell renders and does not listen: the service owns the connection, the dedup and the
 * alerting, so this stays the same bell whether its alerts arrive from the audit stream or from a
 * later channel.
 */
export function NotificationBell({ events, unread, onClear, onSeen }: NotificationBellProps): React.JSX.Element {
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
      {open && <NotificationPopup events={events} onClear={onClear} onMarkAllRead={onSeen} />}
    </div>
  );
}
