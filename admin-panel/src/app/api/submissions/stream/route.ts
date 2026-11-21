import { prisma } from '@/lib/prisma';
import { createLiveStreamRoute } from '@/lib/live/stream-route';
import { polledSource } from '@/lib/live/polled-source';
import { readAuditEntityCursor } from '@/lib/live/cursors';
import { cursorFrameFingerprint, type CursorFrame } from '@/lib/live/frames';
import { LIST_CURSOR_POLL_MS } from '@/lib/constants/live-stream';

export const dynamic = 'force-dynamic';

/**
 * The list's change cursor: the newest submission, the newest graded testcase, and the newest
 * recorded write to any submission.
 *
 * Why not a fingerprint of the rows on the page: the list joins each submission to its participant,
 * task, contest and first result, so a fingerprint over it would cost what the read costs. Each part
 * here is a lookup on an index the table already has — an arrival moves the id, a grading run appends
 * the evaluations it committed, and an edit or a requeue writes an audit row. Why the evaluation rows
 * rather than the results: a result is rewritten in place, so only the evaluations its grading run
 * appends tell that it moved. A score rewritten on an unchanged result is the one change this cursor
 * cannot see.
 */
async function readSubmissionsCursor(): Promise<string> {
  const [newestSubmission, newestEvaluation, newestWrite] = await Promise.all([
    prisma.submissions.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }),
    prisma.evaluations.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }),
    readAuditEntityCursor('submission'),
  ]);
  return `${newestSubmission?.id ?? ''}:${newestEvaluation?.id ?? ''}:${newestWrite ?? ''}`;
}

/**
 * The submissions list's push channel: the list reloads its own page, filters and sort when the
 * cursor moves, because all three belong to the page's query rather than to this route.
 */
export const GET = createLiveStreamRoute<CursorFrame>({
  permissions: ['submission:list'],
  heartbeat: 'restate',
  source: (connection) =>
    polledSource<CursorFrame>({
      initial: { cursor: null },
      fingerprint: cursorFrameFingerprint,
      tracks: [{ intervalMs: LIST_CURSOR_POLL_MS, read: async () => ({ cursor: await readSubmissionsCursor() }) }],
    })(connection),
});
