'use client';

import { useState, useSyncExternalStore } from 'react';
import { AlertTriangle, Timer } from 'lucide-react';

import { Button } from '@/components/core/Button';
import { useFormatTimeOfDay } from '@/components/layout/TimezoneProvider';
import { useDictionary } from '@/hooks/useDictionary';
import { interpolate } from '@/lib/interpolate';

import {
  getServerSubmissionQueueState,
  getSubmissionQueueState,
  subscribeSubmissionQueue,
  type SubmissionQueueState,
} from './submission-queue-store';

function useQueueState(): SubmissionQueueState | null {
  return useSyncExternalStore(subscribeSubmissionQueue, getSubmissionQueueState, getServerSubmissionQueueState);
}

function TimeoutBanner({ retry, title, description, retryLabel }: {
  readonly retry: () => Promise<void>;
  readonly title: string;
  readonly description: string;
  readonly retryLabel: string;
}): React.JSX.Element {
  const [retrying, setRetrying] = useState(false);
  const run = async (): Promise<void> => {
    setRetrying(true);
    try {
      await retry();
    } finally {
      setRetrying(false);
    }
  };
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
    >
      <span className="inline-flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span>
          <span className="font-semibold">{title}</span>
          {' — '}
          {description}
        </span>
      </span>
      <Button variant="negativeOutline" size="sm" disabled={retrying} onClick={() => void run()}>
        {retryLabel}
      </Button>
    </div>
  );
}

export function SubmissionQueuedBanner(): React.JSX.Element | null {
  const queue = useQueueState();
  const dictionary = useDictionary();
  const formatTime = useFormatTimeOfDay();
  if (queue === null) return null;
  if (queue.kind === 'timeout') {
    const retry = dictionary.submissions.retry;
    return <TimeoutBanner retry={queue.retry} title={retry.title} description={retry.description} retryLabel={retry.action} />;
  }
  const message = interpolate(dictionary.submissions.queued.bannerAt, { time: formatTime(new Date(queue.queuedAt)) });
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-xl border border-info/30 bg-info/10 px-4 py-3 text-sm text-info"
    >
      <Timer className="w-4 h-4 shrink-0" aria-hidden="true" />
      {message}
    </div>
  );
}
