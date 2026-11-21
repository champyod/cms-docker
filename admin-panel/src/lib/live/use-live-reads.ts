'use client';

import { useCallback, useState } from 'react';

/** The read instant behind each part of one surface's frame, by the section that part belongs to. */
export type LiveReadInstants<Section extends string> = Readonly<Partial<Record<Section, string>>>;

export interface LiveReads<Section extends string> {
  /** The read that produced the value now shown for each section. */
  readonly reads: LiveReadInstants<Section>;
  /**
   * The newest read that has covered each section — what its rows are compared against. Equal to
   * `reads` for a section a pass refills, and ahead of it once the pass that owns the section has run
   * without refilling it.
   */
  readonly surfaces: LiveReadInstants<Section>;
  /**
   * Records the read that produced a section's value, as the frame states it. Both instants move to
   * it: that one read produced the value *and* covered the section.
   */
  readonly record: (section: Section, readAt: string) => void;
  /**
   * Records the newest read that has covered a section which this frame carried forward or left out,
   * so its baseline moves while the value it is still showing keeps its own older read.
   */
  readonly cover: (section: Section, readAt: string) => void;
}

/** The two instants one surface holds per section, in one record so a frame updates them together. */
interface LiveReadRecord<Section extends string> {
  readonly reads: Partial<Record<Section, string>>;
  readonly surfaces: Partial<Record<Section, string>>;
}

/**
 * Which read produced the value a surface is showing for each part of its frame.
 *
 * Why this exists at all: a frame can carry a part the server did not re-read in that pass — either
 * because the pass only sampled another part, or because the read failed and the section was left out
 * — and the panel keeps showing the older value. Nothing else in the panel remembers when that value
 * was read, so the freshness cue would have nothing to compare against; nothing remembers when the
 * section was last *covered* either, so a section whose own pass stopped refilling it would look as
 * current as the value it is still showing.
 *
 * Why one hook instead of a stamp per surface: the same record and the same comparison serve every row
 * surface, and written per surface the two drift — one of them stamps the frame's instant onto a
 * section the server did not re-read, and reports stale data as fresh.
 */
export function useLiveReadInstants<Section extends string>(): LiveReads<Section> {
  const [recorded, setRecorded] = useState<LiveReadRecord<Section>>({ reads: {}, surfaces: {} });

  const record = useCallback((section: Section, readAt: string): void => {
    setRecorded((previous) => {
      // Why the previous record is returned unchanged: a restated heartbeat re-delivers the payload it
      // last stated, and rebuilding the record for it would re-render the whole surface every
      // heartbeat for a read that already happened.
      if (previous.reads[section] === readAt && previous.surfaces[section] === readAt) return previous;
      return {
        reads: { ...previous.reads, [section]: readAt },
        surfaces: { ...previous.surfaces, [section]: readAt },
      };
    });
  }, []);

  const cover = useCallback((section: Section, readAt: string): void => {
    setRecorded((previous) => {
      if (previous.surfaces[section] === readAt) return previous;
      return { ...previous, surfaces: { ...previous.surfaces, [section]: readAt } };
    });
  }, []);

  return { reads: recorded.reads, surfaces: recorded.surfaces, record, cover };
}
