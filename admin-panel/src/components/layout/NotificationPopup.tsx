'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useFormatTimestamp, type TimestampFormatter } from '@/components/layout/TimezoneProvider';
import { localeFromPathname } from '@/lib/navigation/breadcrumbs';
import { buildRoute } from '@/lib/navigation/routes';
import type { QueuedNotification } from '@/lib/notification-queue';

interface NotificationPopupProps {
  readonly events: readonly QueuedNotification[];
  readonly onClear: () => void;
  readonly onMarkAllRead: () => void;
}

// Why this exact class list: the panel anchors to the bell from sm up, and falls back to a full-width
// sheet below it, where an absolutely positioned panel would be clipped by the shell's own header.
const POPUP_CLASS =
  'fixed inset-x-3 top-16 max-h-96 overflow-y-auto rounded-xl border border-border bg-card shadow-xl z-50 sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-80 sm:max-w-none';

const ACTION_CLASS = 'text-xs text-muted-foreground hover:text-foreground';

const ROW_CLASS = 'block px-3 py-2 hover:bg-muted/50';

interface AlertEntryProps {
  readonly event: QueuedNotification;
  readonly locale: string;
  readonly formatTimestamp: TimestampFormatter;
}

/**
 * One alert: the wording the action that published it produced, and the way out of it.
 *
 * Why the row's own markup is built once and wrapped twice: an alert the panel has no page for still
 * belongs on the list, and linking it to the log would send the reader to a page that cannot resolve
 * the row they came to read.
 */
function AlertEntry({ event, locale, formatTimestamp }: AlertEntryProps): React.JSX.Element {
  const body = (
    <>
      <p className="text-xs font-semibold text-foreground">{event.title}</p>
      <p className="text-xs text-muted-foreground break-words">{event.detail}</p>
      <p className="font-mono text-[10px] text-muted-foreground/70">{formatTimestamp(event.timestamp)}</p>
    </>
  );
  return (
    <li className="border-b border-border/50 last:border-0">
      {event.destination === undefined ? (
        <div className={ROW_CLASS}>{body}</div>
      ) : (
        <Link href={buildRoute(locale, event.destination)} className={ROW_CLASS}>
          {body}
        </Link>
      )}
    </li>
  );
}

/**
 * The bell's own panel: the alerts the shared live service holds, with the ways out of it.
 *
 * Why the service and not a listener of its own: the panel only renders what the service already
 * received, so opening the bell never opens a second connection to the alert stream.
 *
 * Why it still offers mark-all-read after opening already cleared the count: alerts keep arriving
 * under an open panel, so the count can climb again while the reader sits on it.
 */
export function NotificationPopup({ events, onClear, onMarkAllRead }: NotificationPopupProps): React.JSX.Element {
  const formatTimestamp = useFormatTimestamp();
  const locale = localeFromPathname(usePathname());
  return (
    <div className={POPUP_CLASS}>
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">System alerts</span>
        <span className="flex items-center gap-3">
          <button type="button" onClick={onMarkAllRead} className={ACTION_CLASS}>
            Mark all read
          </button>
          <button type="button" onClick={onClear} className={ACTION_CLASS}>
            Clear
          </button>
        </span>
      </div>
      {events.length === 0 ? (
        <p className="px-3 py-4 text-xs text-muted-foreground">No alerts yet.</p>
      ) : (
        <ul>
          {events.map((event) => (
            <AlertEntry key={event.id} event={event} locale={locale} formatTimestamp={formatTimestamp} />
          ))}
        </ul>
      )}
    </div>
  );
}
