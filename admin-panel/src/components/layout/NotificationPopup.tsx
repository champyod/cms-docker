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
import { auditCueCopy, type AuditCueCopy } from '@/lib/system-alert-copy';

interface NotificationPopupProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The bell the panel belongs to, so a press on it stays the bell's own toggle. */
  readonly anchorRef: RefObject<HTMLElement | null>;
  readonly events: readonly QueuedNotification[];
  readonly onClear: () => void;
  readonly onMarkAllRead: () => void;
}

/** A dialog, so the portal escapes the header's stacking context and escape and outside-press come from the primitive. */
const POPUP_CLASS =
  'inset-auto right-3 top-16 left-auto z-50 w-[calc(100vw-1.5rem)] max-h-[min(24rem,70dvh)] max-w-none gap-2 p-3 rounded-xl border border-border bg-card shadow-xl sm:right-3 sm:top-16 sm:left-auto sm:w-80 sm:max-w-80 sm:max-h-96 sm:rounded-xl sm:p-3 sm:translate-x-0 sm:translate-y-0';

const ACTION_CLASS = 'text-xs text-muted-foreground hover:text-foreground';

const ROW_CLASS = 'block py-2 hover:bg-muted/50';

interface AlertEntryProps {
  readonly event: QueuedNotification;
  readonly locale: string;
  readonly formatTimestamp: TimestampFormatter;
  readonly copy: AuditCueCopy;
}

/** An alert with no page still belongs on the list, but must not link to a page that cannot resolve its row. */
function AlertEntry({ event, locale, formatTimestamp, copy }: AlertEntryProps): React.JSX.Element {
  // The frame carries the event's parts, so every row reads in the reader's language, even rows from before a locale switch.
  const { title, detail } = auditCueCopy(event.cue, copy);
  const body = (
    <>
      <p className="text-xs font-semibold text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground break-words">{detail}</p>
      <p className="font-mono text-xs text-muted-foreground/70">{formatTimestamp(event.timestamp)}</p>
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

/** The panel renders what the service already received; opening the bell opens no second connection. */
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
      // Non-modal: the page behind stays usable and the bell keeps its own toggle.
      modal={false}
      title={copy.title}
      className={POPUP_CLASS}
      // A press on the bell is the panel's own toggle, so dismissing on it would close and reopen it.
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
            <AlertEntry
              key={event.id}
              event={event}
              locale={locale}
              formatTimestamp={formatTimestamp}
              copy={copy.audit}
            />
          ))}
        </ul>
      )}
    </Dialog>
  );
}
