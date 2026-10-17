'use client';

import type { RefObject } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Dialog } from '@/components/core/Dialog';
import { useFormatTimestamp, type TimestampFormatter } from '@/components/layout/TimezoneProvider';
import { useDictionary } from '@/hooks/useDictionary';
import { localeFromPathname } from '@/lib/navigation/breadcrumbs';
import { buildRoute } from '@/lib/navigation/routes';
import type { QueuedNotification } from '@/lib/notification-queue';

interface NotificationPopupProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The bell the panel belongs to, so a press on it stays the bell's own toggle. */
  readonly anchorRef: RefObject<HTMLElement | null>;
  readonly events: readonly QueuedNotification[];
  readonly onClear: () => void;
  readonly onMarkAllRead: () => void;
}

/**
 * Why the panel is a dialog rather than an absolutely positioned box: the content is portalled out
 * of the shell, so the header's own stacking context cannot clip it, and escape, outside press and
 * focus return come from the primitive instead of from a second set of listeners. It keeps the one
 * layer dialog content already sits on — the panel raises no z-index of its own.
 *
 * Why every size is placed against the viewport rather than against the bell: the panel renders in
 * the portal, where an absolutely positioned box would be measured against whatever positioned
 * ancestor the page happens to give it, while the header is pinned to the top edge at every width.
 */
const POPUP_CLASS =
  'inset-auto right-3 top-16 left-auto z-50 w-[calc(100vw-1.5rem)] max-h-[min(24rem,70dvh)] max-w-none gap-2 p-3 rounded-xl border border-border bg-card shadow-xl sm:right-3 sm:top-16 sm:left-auto sm:w-80 sm:max-w-80 sm:max-h-96 sm:p-3 sm:translate-x-0 sm:translate-y-0';

const ACTION_CLASS = 'text-xs text-muted-foreground hover:text-foreground';

const ROW_CLASS = 'block py-2 hover:bg-muted/50';

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
export function NotificationPopup({
  open,
  onOpenChange,
  anchorRef,
  events,
  onClear,
  onMarkAllRead,
}: NotificationPopupProps): React.JSX.Element {
  const formatTimestamp = useFormatTimestamp();
  const locale = localeFromPathname(usePathname());
  const copy = useDictionary().systemAlerts;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      // Why non-modal: the panel is the bell's own, and the page it is read against stays usable —
      // the reader can follow a link, and the bell keeps its own toggle.
      modal={false}
      title={copy.title}
      className={POPUP_CLASS}
      // Why the bell is exempt: a press on it is the panel's own toggle, so a dismissal here would
      // close the panel and the same press would open it again.
      onInteractOutside={(event) => {
        const target = event.target;
        if (target instanceof Node && anchorRef.current?.contains(target) === true) event.preventDefault();
      }}
      footer={
        <span className="flex items-center gap-3">
          <button type="button" onClick={onMarkAllRead} className={ACTION_CLASS}>
            {copy.markAllRead}
          </button>
          <button type="button" onClick={onClear} className={ACTION_CLASS}>
            {copy.clear}
          </button>
        </span>
      }
    >
      {events.length === 0 ? (
        <p className="py-4 text-xs text-muted-foreground">{copy.empty}</p>
      ) : (
        <ul>
          {events.map((event) => (
            <AlertEntry key={event.id} event={event} locale={locale} formatTimestamp={formatTimestamp} />
          ))}
        </ul>
      )}
    </Dialog>
  );
}
