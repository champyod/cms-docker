import { prisma } from '@/lib/prisma';
import { createLiveStreamRoute } from '@/lib/live/stream-route';
import { polledSource } from '@/lib/live/polled-source';
import { cursorFrameFingerprint, type CursorFrame } from '@/lib/live/frames';
import { LIST_CURSOR_POLL_MS } from '@/lib/constants/live-stream';
import { parseRecordId } from '@/lib/queries/record-access';

export const dynamic = 'force-dynamic';

/** The record this connection watches: the id in its own path, or null for a URL the panel never links. */
function readSubmissionId(request: Request): number | null {
  const segments = new URL(request.url).pathname.split('/');
  return parseRecordId(segments[segments.length - 2] ?? '');
}

/**
 * One record's change cursor: the submission's own editable fields, the newest testcase it has been
 * graded on, and how many dataset results it holds.
 *
 * Why not a fingerprint of the record's read models: those are gated field by field and joined
 * through the participant, task and contest, so a fingerprint over them would cost the record read.
 * Each part here is a lookup on a key that already exists — the row read is by primary key, a grading
 * run appends the evaluations it committed, and a result created or invalidated moves the count. A
 * score rewritten on a result that already exists is the one change this cursor cannot see. Why a
 * path naming no record publishes the empty cursor: the record conceals such a URL, so this channel
 * only has to sit still rather than put the browser's reconnect backoff on a page nobody can open.
 */
async function readSubmissionCursor(submissionId: number | null): Promise<string> {
  if (submissionId === null) return '';
  const [row, newestEvaluation, resultCount] = await Promise.all([
    prisma.submissions.findUnique({
      where: { id: submissionId },
      select: { comment: true, official: true },
    }),
    prisma.evaluations.findFirst({
      where: { submission_id: submissionId },
      orderBy: { id: 'desc' },
      select: { id: true },
    }),
    prisma.submission_results.count({ where: { submission_id: submissionId } }),
  ]);
  return `${row?.comment ?? ''}:${row?.official ?? ''}:${newestEvaluation?.id ?? ''}:${resultCount}`;
}

/**
 * The record's push channel: the open record re-renders when the submission is edited or regraded.
 *
 * Why the gate is the record's own read key: the tabs behind it re-check their own keys on every read
 * they perform, so this connection only has to decide whether the record may exist for this viewer.
 */
export const GET = createLiveStreamRoute<CursorFrame>({
  permissions: ['submission:read'],
  heartbeat: 'restate',
  source: (connection) => {
    const submissionId = readSubmissionId(connection.request);
    return polledSource<CursorFrame>({
      initial: { cursor: null },
      fingerprint: cursorFrameFingerprint,
      tracks: [{ intervalMs: LIST_CURSOR_POLL_MS, read: async () => ({ cursor: await readSubmissionCursor(submissionId) }) }],
    })(connection);
  },
});
