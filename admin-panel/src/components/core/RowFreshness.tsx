'use client';

import React from 'react';

import { useDictionary } from '@/hooks/useDictionary';
import { interpolate } from '@/lib/interpolate';
import { rowFreshness } from '@/lib/live/row-freshness';
import { cn } from '@/lib/utils';
import type { LiveStatus } from '@/hooks/useLiveStream';

export interface RowFreshnessProps {
  /** The instant of the read that produced this row's value, as the frame that delivered it stated it. */
  readonly readAt: string | null | undefined;
  /** The newest read this row's surface has been told about — what the row is compared against. */
  readonly surfaceReadAt: string | null | undefined;
  /** The state of the stream that feeds the row's surface. */
  readonly streamStatus: LiveStatus;
  readonly className?: string;
  readonly children: React.ReactNode;
}

/**
 * Why the mark is a left rule and nothing else: a row that is current is the normal row, so it carries
 * no marker at all — a label or a dot saying "this one is fine" is the status blob the panel retired,
 * repeated once per row. The rule widens under high contrast like the rest of the panel's tones.
 * Why nothing animates: fresh and stale alternate as frames arrive, and motion on a data table would
 * announce every heartbeat while telling the reader nothing, and would not survive reduced motion.
 */
const STALE_MARK = 'border-l-2 border-warning/60 pl-2 high-contrast:border-warning';

function formatInstant(instant: string): string {
  const parsed = new Date(instant);
  return Number.isNaN(parsed.getTime()) ? instant : parsed.toLocaleTimeString();
}

/**
 * The one per-row freshness cue.
 *
 * A row whose value came from an older read than the newest one its surface has been told about is
 * marked in place; every other row renders exactly what it rendered before. Why in place and not
 * beside the data: the reader needs to see which row is behind, and an extra column for it would be
 * empty on almost every row.
 */
export function RowFreshness({ readAt, surfaceReadAt, streamStatus, className, children }: RowFreshnessProps): React.JSX.Element {
  const dict = useDictionary();
  const state = rowFreshness({ readAt, surfaceReadAt, streamStatus });

  // Why the sentence is built only for a row that is behind: it is the accessible half of a mark that
  // is otherwise purely visual, and a current row has nothing to announce.
  const announcement = state !== 'stale' || typeof readAt !== 'string'
    ? null
    : streamStatus === 'reconnecting'
      ? interpolate(dict.live.rowUnconfirmed, { readAt: formatInstant(readAt) })
      : interpolate(dict.live.rowBehind, {
        readAt: formatInstant(readAt),
        surfaceReadAt: formatInstant(String(surfaceReadAt)),
      });

  return (
    <div className={cn(state === 'stale' && STALE_MARK, className)} data-freshness={state} title={announcement ?? undefined}>
      {children}
      {announcement === null ? null : <span className="sr-only">{announcement}</span>}
    </div>
  );
}
