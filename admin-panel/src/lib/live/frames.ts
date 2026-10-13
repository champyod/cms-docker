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
