'use client';

import { LiveIndicator } from '@/components/core/LiveIndicator';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useLiveCursor } from '@/lib/live/use-live-cursor';

import { setSubmissionQueue } from './submission-queue-store';

export function SubmissionRecordLiveRefresh({ url }: { readonly url: string }): React.JSX.Element {
  const router = useAppRouter();
  const status = useLiveCursor(url, () => {
    setSubmissionQueue(null);
    router.refresh();
  });
  return <LiveIndicator status={status} />;
}
