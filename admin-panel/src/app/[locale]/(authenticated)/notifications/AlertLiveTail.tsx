'use client';

import Link from 'next/link';

import { Badge } from '@/components/core/Badge';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { useFormatTimestamp } from '@/components/layout/TimezoneProvider';
import { useLiveNotifications } from '@/lib/live/notifications';
import type { NotificationsCopy } from './alertColumns';

interface AlertLiveTailProps {
  readonly copy: NotificationsCopy;
  readonly auditLogHref: string;
}

/**
 * The live tail: the alerts the shared service has already received, above the paged history.
 *
 * Why a tail sits above a paged table: the alert that just fired is the one a reader acts on, while
 * the history below is a page of rows rather than a feed.
 */
export function AlertLiveTail({ copy, auditLogHref }: AlertLiveTailProps): React.JSX.Element {
  const { events, unread, markSeen } = useLiveNotifications();
  const formatTimestamp = useFormatTimestamp();
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{copy.liveTitle}</span>
          {unread > 0 && <Badge variant="destructive">{unread}</Badge>}
        </div>
        <Button variant="ghost" size="sm" onClick={markSeen}>
          {copy.markAllRead}
        </Button>
      </div>
      {events.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{copy.liveEmpty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {events.map((event) => (
            <li key={event.id}>
              {/* Why an alert opens the log rather than its own row: the live frame carries the
                  alert's wording and row id only, so the log is the page that can show the record. */}
              <Link href={auditLogHref} className="block py-2 hover:bg-muted/50">
                <p className="text-sm font-medium text-foreground">{event.title}</p>
                <p className="text-xs text-muted-foreground break-words">{event.detail}</p>
                <p className="font-mono text-[10px] text-muted-foreground/70">
                  {formatTimestamp(event.timestamp)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
