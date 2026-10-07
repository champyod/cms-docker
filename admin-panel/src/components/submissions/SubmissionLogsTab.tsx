'use client';

import { Terminal } from 'lucide-react';

import { Card } from '@/components/core/Card';
import { EmptyState } from '@/components/core/EmptyState';
import type { Dictionary } from '@/lib/dictionary';
import type { SubmissionLogsModel } from '@/lib/evaluation-read-model-types';

export interface SubmissionLogsTabProps {
  readonly model: SubmissionLogsModel;
  readonly navigation: Dictionary['navigation'];
}

// Why one joined block: the modal presented the compiler output as a single
// scrollable stream, and splitting the three streams into separate panes made
// interleaved stdout and stderr unreadable.
function logStream(model: SubmissionLogsModel): string {
  const sections = [
    model.compilationText.join('\n'),
    model.compilationStdout ? `Stdout:\n${model.compilationStdout}` : '',
    model.compilationStderr ? `Stderr:\n${model.compilationStderr}` : '',
  ];
  return sections.filter((section) => section !== '').join('\n');
}

export function SubmissionLogsTab({ model, navigation }: SubmissionLogsTabProps): React.JSX.Element {
  const stream = logStream(model);
  return (
    <div className="space-y-6">
      <Card className="space-y-1">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Compilation</h3>
        <span className="font-medium capitalize">{model.compilationOutcome || 'Pending...'}</span>
      </Card>
      {stream === '' ? (
        <EmptyState
          icon={Terminal}
          title="No compilation logs"
          description="Compiler output appears once the submission has been compiled."
        />
      ) : (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Terminal className="w-4 h-4 text-muted-foreground" />
            {`Compilation Logs — ${navigation.evaluation['submission-record'].label} #${model.submissionId}`}
          </h3>
          <div className="bg-background rounded-lg p-4 font-mono text-xs overflow-x-auto whitespace-pre-wrap border border-border">
            {stream}
          </div>
        </div>
      )}
    </div>
  );
}
