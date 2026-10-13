import { createLiveStreamRoute } from '@/lib/live/stream-route';
import { polledSource } from '@/lib/live/polled-source';
import { questionsFrameFingerprint, type QuestionsFrame } from '@/lib/live/frames';
import { readUnansweredQuestions } from '@/lib/questions-reader';
import { QUESTIONS_POLL_MS } from '@/lib/constants/live-stream';

export const dynamic = 'force-dynamic';

/**
 * The header's unanswered-question channel: the count behind its dot, the newest row behind its alert.
 *
 * Why the page's own permission gates the connection: the header offers the dot only to a viewer who
 * may list questions, and the stream behind it must not hand that viewer anything the list would not.
 */
export const GET = createLiveStreamRoute<QuestionsFrame>({
  permissions: ['question:list'],
  heartbeat: 'restate',
  source: (connection) =>
    polledSource<QuestionsFrame>({
      initial: { unansweredCount: 0, latest: null },
      fingerprint: questionsFrameFingerprint,
      tracks: [{ intervalMs: QUESTIONS_POLL_MS, read: readUnansweredQuestions }],
    })(connection),
});
