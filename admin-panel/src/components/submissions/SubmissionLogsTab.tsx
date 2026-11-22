'use client';

import { Terminal } from 'lucide-react';

import { EmptyState } from '@/components/core/EmptyState';
import { useDictionary } from '@/hooks/useDictionary';
import type { SubmissionLogsModel } from '@/lib/evaluation-read-model-types';

export interface SubmissionLogsTabProps {
  readonly model: SubmissionLogsModel;
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

/**
 * The compiler's output, as one stream.
 *
 * Why no heading and no outcome card: the page's fact strip states the compilation outcome and the
 * tab rail names Logs, so the card above the stream said both again - and the heading also spelled
 * out which submission, which the record shell had already said in a larger type.
 */
export function SubmissionLogsTab({ model }: SubmissionLogsTabProps): React.JSX.Element {
  const dictionary = useDictionary();
  const stream = logStream(model);
  if (stream === '') {
    return (
      <EmptyState
        icon={Terminal}
        title={dictionary.submissions.record.logs.emptyTitle}
        description={dictionary.submissions.record.logs.emptyDescription}
      />
    );
  }
  return (
    <div className="bg-background rounded-lg p-4 font-mono text-xs whitespace-pre-wrap border border-border">
      {stream}
    </div>
  );
}
