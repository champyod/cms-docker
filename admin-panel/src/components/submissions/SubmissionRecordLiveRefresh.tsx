'use client';

import { useAppRouter } from '@/hooks/useAppRouter';
import { useLiveCursor } from '@/lib/live/use-live-cursor';

import { setSubmissionQueue } from './submission-queue-store';

/**
 * Keeps one submission's record current while it is on screen.
 *
 * Why it renders nothing: the record re-reads itself on a new cursor, and a submission that has not
 * changed is not an event a reader has to be told about. Why it still clears the queued banner: the
 * banner reports work this panel queued, so a server-side change is what retires it.
 */
export function SubmissionRecordLiveRefresh({ url }: { readonly url: string }): null {
  const router = useAppRouter();
  useLiveCursor(url, () => {
    setSubmissionQueue(null);
    router.refresh();
  });
  return null;
}
