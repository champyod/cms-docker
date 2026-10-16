import type { LiveStatus } from '@/hooks/useLiveStream';

/**
 * Whether a row is what the server currently says it is.
 *
 * Why the comparison is made of two instants and never of elapsed time: the only thing that says how
 * old a value is, is the instant of the read that produced it, and the only thing to compare it against
 * is the newest read the surface has been told about. "No frame for N seconds" is a guess about a
 * connection rather than a fact about the data — acting on silence is the stream watchdog's job.
 *
 * Why the stream's own state is part of the rule rather than a timer standing in for it: a stream that
 * has dropped cannot confirm anything, and that is a fact the transport reports. Without it, a row on
 * an unchanged surface and a row on a dead one would be indistinguishable — which is the whole reason
 * this cue exists — because a dead stream and an unchanged one deliver exactly the same thing: nothing.
 */
export interface RowFreshnessInput {
  /** The instant of the read that produced this row's value, as the frame that delivered it stated it. */
  readonly readAt: string | null | undefined;
  /** The newest read the row's own surface has been told about. */
  readonly surfaceReadAt: string | null | undefined;
  /** The state of the stream that feeds the row's surface. */
  readonly streamStatus: LiveStatus;
}

/**
 * Why an unreadable instant is `unknown` and never `fresh`: an instant the panel cannot read is not
 * evidence of a recent read, and reporting it as fresh would have the cue invent the one thing it
 * exists to report.
 */
export type RowFreshnessState = 'unknown' | 'fresh' | 'stale';

function readInstant(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function rowFreshness({ readAt, surfaceReadAt, streamStatus }: RowFreshnessInput): RowFreshnessState {
  const row = readInstant(readAt);
  // Nothing the panel can date produced this row, so there is nothing to say about its age.
  if (row === null) return 'unknown';

  // Why only reconnecting withdraws the surface's word: `connecting` is a surface that has stated
  // nothing yet and has no rows of its own, and `paused` is the panel's own choice while the tab is
  // hidden — the reader is not looking, and the reconnect restores a fresh snapshot anyway. The state
  // that means the stream is gone is the one the transport reached on its own.
  if (streamStatus === 'reconnecting') return 'stale';

  const surface = readInstant(surfaceReadAt);
  // The surface has stated no read at all, so there is nothing to compare the row against.
  if (surface === null) return 'unknown';

  // Strictly older: a row from the same read as the surface's newest is current, which is what keeps
  // data that simply has not changed from being marked as if the stream had died.
  return row < surface ? 'stale' : 'fresh';
}
