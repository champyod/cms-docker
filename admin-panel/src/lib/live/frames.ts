import type { WorkerNodeView } from '@/lib/worker-nodes';

/**
 * The frame contracts the live surfaces added on the shared helper and their panels agree on.
 *
 * Why the questions fields are always present and the audit cursor is not: the questions channel
 * carries one viewer's whole signal, so a missing section would only mean a failed read, while the
 * audit cursor is null on an empty log — a state the table must not read as "no rows were added".
 */

/** One unanswered question, as the header's alert and its dot both read it. */
export interface UnansweredQuestion {
  id: number;
  subject: string;
  username: string | null;
  askedAt: string;
}

export interface QuestionsFrame {
  unansweredCount: number;
  latest: UnansweredQuestion | null;
}

/** The audit log's cursor: the newest row id, so the table refreshes when a row lands. */
export interface AuditCursorFrame {
  latestId: string | null;
}

/** Why the newest question's id rather than its row: an edit to an answer must not count as an arrival. */
export function questionsFrameFingerprint(frame: QuestionsFrame): string {
  return JSON.stringify([frame.unansweredCount, frame.latest?.id ?? null]);
}

export function auditCursorFingerprint(frame: AuditCursorFrame): string {
  return JSON.stringify(frame.latestId);
}

/**
 * A surface's change cursor: an opaque token that moves when that surface's data does.
 *
 * Why one frame for every list surface: each of these pages reloads its own query when the cursor
 * moves, so what the cursor is built from — an audit id, a row count — belongs to the route that
 * knows its data, and not to the panel that only compares one cursor with the last.
 */
export interface CursorFrame {
  cursor: string | null;
}

/** Worker telemetry, as the deployments panel and the resources page both read it. */
export interface WorkersFrame {
  workers: WorkerNodeView[];
  /** Set when the reading is empty because the fleet's configuration could not be read. */
  error?: string | null;
}

export function cursorFrameFingerprint(frame: CursorFrame): string {
  return JSON.stringify(frame.cursor);
}

export function workersFrameFingerprint(frame: WorkersFrame): string {
  return JSON.stringify([frame.workers, frame.error ?? null]);
}

/**
 * The read instant the frame states for each section it carried forward, by the section's name.
 *
 * Why a frame states these at all: one frame accumulates what several poll tracks read on different
 * cadences, so a section can travel forward in a frame its own track did not run for. Stating the
 * section's own read is what keeps the cue from dating that section by a read that did not produce
 * it — the misdating a single frame-level instant cannot avoid.
 *
 * Why the sections the frame's own pass read are absent: they share `readAt`, which is already the
 * read that produced them, and a second copy of one instant is one more thing to keep in step. A
 * consumer resolves a section as `reads?.[section] ?? readAt`.
 */
export type LiveSectionReads = Readonly<Record<string, string>>;

/**
 * What every live frame travels in: its payload, and the instant the server's read produced it.
 *
 * Why the read instant rides on the wire instead of being stamped when the browser receives the frame:
 * a surface has to say how old the value it is showing is, and only the server saw that read. An
 * arrival stamp dates the delivery — it would report a frame the server had been holding as fresh —
 * and it reads the browser's clock for a fact that belongs to the server's.
 *
 * Why the envelope is one contract in one place: every stream and every consumer shares this shape, so
 * a second copy of it is a second thing to keep in step, and the row-freshness cue reads it for every
 * surface at once.
 */
export interface LiveEnvelope<TFrame> {
  readonly readAt: string;
  readonly frame: TFrame;
  /** Omitted when the pass that produced the frame read every section the frame carries. */
  readonly reads?: LiveSectionReads;
}

export function encodeLiveEnvelope<TFrame>(frame: TFrame, readAt: string, reads?: LiveSectionReads): string {
  const envelope: LiveEnvelope<TFrame> = reads === undefined || Object.keys(reads).length === 0
    ? { readAt, frame }
    : { readAt, frame, reads };
  return JSON.stringify(envelope);
}

/**
 * The read a frame states for one of the sections it carries: the section's own where the frame
 * carried it forward, the frame's own where the pass that produced the frame read the section.
 *
 * Why one resolver instead of reading the map at every call site: which of the two instants a section
 * gets is the whole rule, and written per consumer the surfaces drift into two different answers.
 */
export function sectionReadAt(readAt: string, reads: LiveSectionReads | undefined, section: string): string {
  return reads?.[section] ?? readAt;
}

/**
 * Why a frame that is not an envelope decodes to null rather than to a substituted payload: a consumer
 * handed a guessed frame would report invented data as read, and the cue built on it would mark rows
 * against an instant nobody observed. The caller drops the frame; the stream's watchdog still bounds
 * the connection's lifetime.
 */
export function decodeLiveEnvelope<TFrame>(raw: string): LiveEnvelope<TFrame> | null {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { readAt, frame, reads } = parsed as Partial<LiveEnvelope<TFrame>>;
  if (typeof readAt !== 'string' || Number.isNaN(Date.parse(readAt))) return null;
  if (!('frame' in parsed)) return null;
  // Why a malformed section read drops the whole frame and not just the entry: a consumer would
  // otherwise fall back to the frame's read for that section and date a carried-forward section by a
  // read that never produced it — the exact lie this contract exists to prevent.
  if (reads !== undefined && !isSectionReads(reads)) return null;
  return reads === undefined
    ? { readAt, frame: frame as TFrame }
    : { readAt, frame: frame as TFrame, reads };
}

function isSectionReads(value: unknown): value is LiveSectionReads {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every(
    (instant) => typeof instant === 'string' && !Number.isNaN(Date.parse(instant)),
  );
}
