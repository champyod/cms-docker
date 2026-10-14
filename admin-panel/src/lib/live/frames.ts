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
