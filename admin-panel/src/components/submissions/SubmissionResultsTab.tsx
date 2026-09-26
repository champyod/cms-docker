'use client';

import { AlertCircle, CheckCircle2, FileCode, Loader2, XCircle } from 'lucide-react';

import { Card } from '@/components/core/Card';
import { EmptyState } from '@/components/core/EmptyState';
import type { Dictionary } from '@/lib/dictionary';
import type { SubmissionResultsModel, SubmissionSummary } from '@/lib/evaluation-read-model-types';
import { cn } from '@/lib/utils';

import { SubmissionActionBar } from './SubmissionActionBar';

type ResultRow = SubmissionResultsModel['results'][number];

export interface SubmissionResultsTabProps {
  readonly model: SubmissionResultsModel;
  readonly capabilities: SubmissionSummary['capabilities'];
  readonly navigation: Dictionary['navigation'];
}

function outcomeGlyph(outcome: string | null): React.JSX.Element {
  if (outcome === 'ok') return <CheckCircle2 className="text-success w-5 h-5 shrink-0" />;
  if (outcome === 'fail') return <XCircle className="text-destructive w-5 h-5 shrink-0" />;
  if (outcome === null) return <Loader2 className="text-info w-5 h-5 animate-spin shrink-0" />;
  return <AlertCircle className="text-muted-foreground w-5 h-5 shrink-0" />;
}

// Why the same wording as the row: the status line is derived from the outcome
// columns, so a reader sees one interpretation per dataset rather than a second
// interpretation in a summary card.
function detailedStatus(result: ResultRow): string {
  if (result.compilationOutcome === null) return 'Compiling';
  if (result.compilationOutcome === 'fail') return 'Compilation Failed';
  if (result.evaluationOutcome === null) return 'Evaluating';
  if (result.score === null) return 'Scoring';
  return 'Done';
}

function scoreTone(result: ResultRow): string {
  return (result.score ?? 0) > 0
    ? 'text-success border-success/30 bg-success/10'
    : 'text-destructive border-destructive/30 bg-destructive/10';
}

function ResultCard({ result }: { readonly result: ResultRow }): React.JSX.Element {
  const compilationFailed = result.compilationOutcome === 'fail';
  return (
    <div className="bg-muted/40 rounded-xl p-4 border border-border space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {`Dataset #${result.datasetId}`}
        </h3>
        {result.score !== null && (
          <span className={cn('text-sm px-2 py-0.5 rounded-full border shrink-0', scoreTone(result))}>
            {`${result.score.toFixed(1)} pts`}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {outcomeGlyph(result.compilationOutcome)}
        <span className="font-medium capitalize">{result.compilationOutcome || 'Pending...'}</span>
      </div>
      <div className="flex items-center gap-2">
        {outcomeGlyph(result.evaluationOutcome)}
        <span className="font-medium capitalize">
          {compilationFailed ? 'Skipped (Compilation Failed)' : result.evaluationOutcome || 'Pending/Skipped'}
        </span>
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground font-mono">
        {result.compilationTime !== null && <span>{`Time: ${result.compilationTime.toFixed(3)}s`}</span>}
        {result.compilationMemoryBytes !== null && (
          <span>{`Memory: ${(result.compilationMemoryBytes / 1024 / 1024).toFixed(2)} MB`}</span>
        )}
        {result.publicScore !== null && <span>{`Public: ${result.publicScore.toFixed(1)}`}</span>}
        {result.scoredAt !== null && <span>{`Scored: ${new Date(result.scoredAt).toLocaleString()}`}</span>}
      </div>
    </div>
  );
}

export function SubmissionResultsTab({ model, capabilities, navigation }: SubmissionResultsTabProps): React.JSX.Element {
  return (
    <div className="space-y-6">
      {model.results.length === 0 ? (
        <EmptyState icon={FileCode} title="No results yet" description="Results appear once the submission has been judged." />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {model.results.map((result) => (
              <ResultCard key={result.datasetId} result={result} />
            ))}
          </div>
          <Card className="space-y-1">
            {model.results.map((result) => (
              <div key={result.datasetId} className="text-sm text-muted-foreground">
                {`Dataset #${result.datasetId}: ${detailedStatus(result)}`}
              </div>
            ))}
          </Card>
        </>
      )}
      {model.files.length > 0 && (
        <Card className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Files</h3>
          {model.files.map((file) => (
            <div key={file.id} className="text-sm font-mono">{file.filename}</div>
          ))}
        </Card>
      )}
      <SubmissionActionBar
        submissionId={model.submissionId}
        capabilities={capabilities}
        entries={['download']}
        navigation={navigation}
      />
    </div>
  );
}
