'use client';

import type { SubmissionHistoryEntry, SubmissionHistoryResult } from '@/app/actions/audit';
import { Card } from '@/components/core/Card';
import { InlineAlert } from '@/components/core/InlineAlert';
import { useFormatTimestamp } from '@/components/layout/TimezoneProvider';
import { useDictionary } from '@/hooks/useDictionary';

export interface SubmissionHistoryTabProps {
  readonly submissionId: number;
  readonly history: SubmissionHistoryResult;
}

function HistoryRow({ entry }: { readonly entry: SubmissionHistoryEntry }): React.JSX.Element {
  const formatTimestamp = useFormatTimestamp();
  const labels = useDictionary().submissions.record.history;
  return (
    <li className="rounded-lg border border-border bg-muted/40 px-3 py-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span>
          <span className="text-muted-foreground">{labels.timestamp}: </span>
          <span className="font-mono text-xs">{formatTimestamp(entry.timestamp)}</span>
        </span>
        <span>
          <span className="text-muted-foreground">{labels.actor}: </span>
          <span className="font-medium text-foreground">{entry.actor_name ?? '—'}</span>
        </span>
        <span>
          <span className="text-muted-foreground">{labels.action}: </span>
          <span className="font-mono text-xs">{entry.verb}</span>
        </span>
        <span>
          <span className="text-muted-foreground">{labels.result}: </span>
          {entry.result}
        </span>
      </div>
      {entry.reason !== null && entry.reason !== '' && (
        <p className="mt-1 text-sm">
          <span className="text-muted-foreground">{labels.reason}: </span>
          {entry.reason}
        </p>
      )}
    </li>
  );
}

export function SubmissionHistoryTab({ submissionId, history }: SubmissionHistoryTabProps): React.JSX.Element {
  const dictionary = useDictionary();
  const heading = dictionary.submissions.history.label
    + ' — ' + dictionary.navigation.evaluation['submission-record'].label
    + ' #' + submissionId;
  if (!history.success) {
    return <InlineAlert tone="destructive" density="compact">{history.error}</InlineAlert>;
  }
  return (
    <Card className="space-y-3">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{heading}</h3>
      {history.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{dictionary.submissions.history.empty}</p>
      ) : (
        <ul className="space-y-2">
          {history.data.map((entry) => (
            <HistoryRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
    </Card>
  );
}
