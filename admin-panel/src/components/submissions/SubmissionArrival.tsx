'use client';

import { useFormatTimestamp } from '@/components/layout/TimezoneProvider';
import { useDictionary } from '@/hooks/useDictionary';

/**
 * When the submission arrived, in the reader's own zone.
 *
 * Why a client component for one line: the zone lives in the browser, so the record shell cannot
 * format the instant while it renders on the server. A submission belongs to no contest context on
 * this route, so the reviewer's zone is the right one.
 */
export function SubmissionArrival({ timestamp }: { readonly timestamp: string }): React.JSX.Element {
  const formatTimestamp = useFormatTimestamp();
  const labels = useDictionary().submissions.record.identity;
  return (
    <span>
      {labels.time}: <span className="font-mono text-xs">{formatTimestamp(timestamp)}</span>
    </span>
  );
}
