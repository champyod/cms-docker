'use client';

import { ClipboardList } from 'lucide-react';

import { Card } from '@/components/core/Card';
import { EmptyState } from '@/components/core/EmptyState';
import type { Dictionary } from '@/lib/dictionary';
import type { SubmissionEvaluationModel, SubmissionSummary } from '@/lib/evaluation-read-model-types';

import { SubmissionActionBar } from './SubmissionActionBar';

type EvaluationRow = SubmissionEvaluationModel['evaluations'][number];

export interface SubmissionEvaluationTabProps {
  readonly model: SubmissionEvaluationModel;
  readonly capabilities: SubmissionSummary['capabilities'];
  readonly navigation: Dictionary['navigation'];
}

function cellText(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

function resourcesText(row: EvaluationRow): string {
  const time = row.executionTime === null ? null : `${row.executionTime.toFixed(3)}s`;
  const memory = row.executionMemory === null ? null : `${row.executionMemory} B`;
  return [time, memory].filter((part) => part !== null).join(' / ');
}

function EvaluationRowView({ row }: { readonly row: EvaluationRow }): React.JSX.Element {
  return (
    <div className="p-4 space-y-2">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span className="font-medium">{row.testcaseName ?? `Testcase #${row.testcaseId}`}</span>
        <span className="text-muted-foreground font-mono">{`Dataset #${row.datasetId}`}</span>
        <span className="text-muted-foreground font-mono capitalize">{cellText(row.outcome)}</span>
        <span className="text-muted-foreground font-mono">{cellText(resourcesText(row))}</span>
      </div>
      {row.text.length > 0 && (
        <pre className="bg-background rounded-lg p-3 font-mono text-xs overflow-x-auto whitespace-pre-wrap border border-border">
          {row.text.join('\n')}
        </pre>
      )}
    </div>
  );
}

export function SubmissionEvaluationTab({ model, capabilities, navigation }: SubmissionEvaluationTabProps): React.JSX.Element {
  return (
    <div className="space-y-6">
      {model.evaluations.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No testcase evaluations" description="Per-testcase outcomes appear once the submission has been evaluated." />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="divide-y divide-border">
            {model.evaluations.map((row) => (
              <EvaluationRowView key={row.id} row={row} />
            ))}
          </div>
        </Card>
      )}
      <SubmissionActionBar
        submissionId={model.submissionId}
        capabilities={capabilities}
        entries={['lane']}
        navigation={navigation}
      />
    </div>
  );
}
