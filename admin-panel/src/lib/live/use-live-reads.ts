'use client';

import { useCallback, useState } from 'react';

/** The read instant behind each part of one surface's frame, by the section that part belongs to. */
export type LiveReadInstants<Section extends string> = Readonly<Partial<Record<Section, string>>>;

export interface LiveReads<Section extends string> {
  readonly reads: LiveReadInstants<Section>;
  readonly record: (section: Section, readAt: string) => void;
}

/**
 * Which read produced the value a surface is showing for each part of its frame.
 *
 * Why this exists at all: a frame can carry a part the server did not re-read in that pass — either
 * because the pass only sampled another part, or because the read failed and the section was left out
 * — and the panel keeps showing the older value. Nothing else in the panel remembers when that value
 * was read, so the freshness cue would have nothing to compare against.
 *
 * Why one hook instead of a stamp per surface: the same record and the same comparison serve every row
 * surface, and written per surface the two drift — one of them stamps the frame's instant onto a
 * section the server did not re-read, and reports stale data as fresh.
 */
export function useLiveReadInstants<Section extends string>(): LiveReads<Section> {
  const [reads, setReads] = useState<Partial<Record<Section, string>>>({});

  const record = useCallback((section: Section, readAt: string): void => {
    setReads((previous) => {
      // Why the previous record is returned unchanged: a restated heartbeat re-delivers the payload it
      // last stated, and rebuilding the record for it would re-render the whole surface every
      // heartbeat for a read that already happened.
      if (previous[section] === readAt) return previous;
      return { ...previous, [section]: readAt };
    });
  }, []);

  return { reads, record };
}
