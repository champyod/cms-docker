'use client';

import { Terminal } from 'lucide-react';

import { Card } from '@/components/core/Card';
import { EmptyState } from '@/components/core/EmptyState';
import { useDictionary } from '@/hooks/useDictionary';
import type { SubmissionLogsModel } from '@/lib/evaluation-read-model-types';
import { interpolate } from '@/lib/interpolate';

export interface SubmissionLogsTabProps {
  readonly model: SubmissionLogsModel;
  readonly submissionId: number;
}

// Why one joined block: the modal presented the compiler output as a single
// scrollable stream, and splitting the three streams into separate panes made
// interleaved stdout and stderr unreadable.
function logStream(model: SubmissionLogsModel): string {
  const sections = [
    model.compilationText.join('\n'),
    model.compilationStdout ? 'Stdout:\n' + model.compilationStdout : '',
    model.compilationStderr ? 'Stderr:\n' + model.compilationStderr : '',
  ];
  return sections.filter((section) => section !== '').join('\n');
}

export function SubmissionLogsTab({ model, submissionId }: SubmissionLogsTabProps): React.JSX.Element {
  const dictionary = useDictionary();
  const stream = logStream(model);
  return (
    <div className="space-y-6">
      <Card className="space-y-1">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {dictionary.submissions.record.outcome.compilation}
        </h3>
        <span className="font-medium capitalize">
          {model.compilationOutcome ?? dictionary.submissions.record.results.pending}
        </span>
      </Card>
      {stream === '' ? (
        <EmptyState
          icon={Terminal}
          title={dictionary.submissions.record.logs.emptyTitle}
          description={dictionary.submissions.record.logs.emptyDescription}
        />
      ) : (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Terminal className="w-4 h-4 text-muted-foreground" />
            {interpolate(dictionary.submissions.record.logs.title, {
              record: dictionary.navigation.evaluation['submission-record'].label,
              id: submissionId,
            })}
          </h3>
          <div className="bg-background rounded-lg p-4 font-mono text-xs whitespace-pre-wrap border border-border">
            {stream}
          </div>
        </div>
      )}
    </div>
  );
}
