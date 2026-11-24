'use client';

import { AlertCircle, CheckCircle2, FileCode, Loader2, XCircle } from 'lucide-react';

import { Card } from '@/components/core/Card';
import { EmptyState } from '@/components/core/EmptyState';
import { useFormatTimestamp } from '@/components/layout/TimezoneProvider';
import type { Dictionary } from '@/lib/dictionary';
import { formatScore } from '@/lib/format-number';
import type { SubmissionJudgingPhase, SubmissionResultsModel } from '@/lib/evaluation-read-model-types';
import { judgingPhaseLabelKey, judgingPhaseOf } from '@/lib/evaluation-read-model-judging';
import { useDictionary } from '@/hooks/useDictionary';
import { interpolate } from '@/lib/interpolate';
import { cn } from '@/lib/utils';

import { SubmissionFileActions } from './SubmissionFileActions';

type ResultRow = SubmissionResultsModel['results'][number];
type StatusLabels = Dictionary['submissions']['record']['status'];

export interface SubmissionResultsTabProps {
  readonly model: SubmissionResultsModel;
}

function outcomeGlyph(outcome: string | null): React.JSX.Element {
  if (outcome === 'ok') return <CheckCircle2 className="text-success w-5 h-5 shrink-0" />;
  if (outcome === 'fail') return <XCircle className="text-destructive w-5 h-5 shrink-0" />;
  if (outcome === null) return <Loader2 className="text-info w-5 h-5 animate-spin shrink-0" />;
  return <AlertCircle className="text-muted-foreground w-5 h-5 shrink-0" />;
}

// The status line is derived from the same outcome columns, so there is one interpretation per dataset.
function phaseLabel(phase: SubmissionJudgingPhase, labels: StatusLabels): string {
  return labels[judgingPhaseLabelKey(phase)];
}

function scoreTone(result: ResultRow): string {
  return (result.score ?? 0) > 0
    ? 'text-success border-success/30 bg-success/10'
    : 'text-destructive border-destructive/30 bg-destructive/10';
}

function ResultCard({ result }: { readonly result: ResultRow }): React.JSX.Element {
  // A scoring run belongs to the evaluation service, not a contest, so it reads in the reviewer's zone.
  const formatTimestamp = useFormatTimestamp();
  const record = useDictionary().submissions.record;
  const compilationFailed = result.compilationOutcome === 'fail';
  return (
    <div className="bg-muted/40 rounded-xl p-4 border border-border space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {interpolate(record.results.dataset, { id: result.datasetId })}
        </h3>
        {result.score !== null && (
          <span className={cn('text-sm px-2 py-0.5 rounded-full border shrink-0', scoreTone(result))}>
            {interpolate(record.status.points, { score: formatScore(result.score, 1) })}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {outcomeGlyph(result.compilationOutcome)}
        <span className="font-medium capitalize">{result.compilationOutcome ?? record.results.pending}</span>
      </div>
      <div className="flex items-center gap-2">
        {outcomeGlyph(result.evaluationOutcome)}
        <span className="font-medium capitalize">
          {compilationFailed ? record.results.compilationSkipped : result.evaluationOutcome ?? record.results.evaluationSkipped}
        </span>
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground font-mono">
        {result.compilationTime !== null && (
          <span>{record.results.stats.time + ': ' + result.compilationTime.toFixed(3) + 's'}</span>
        )}
        {result.compilationMemoryBytes !== null && (
          <span>{record.results.stats.memory + ': ' + (result.compilationMemoryBytes / 1024 / 1024).toFixed(2) + ' MB'}</span>
        )}
        {result.publicScore !== null && (
          <span>{record.results.stats.public + ': ' + formatScore(result.publicScore, 1)}</span>
        )}
        {result.scoredAt !== null && (
          <span>{record.results.stats.scored + ': ' + formatTimestamp(result.scoredAt)}</span>
        )}
      </div>
    </div>
  );
}

function ResultsFiles({ files }: { readonly files: SubmissionResultsModel['files'] }): React.JSX.Element {
  const source = useDictionary().submissions.record.source;
  return (
    <Card className="space-y-2">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{source.title}</h3>
      {files.map((file) => (
        <div key={file.id} className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-mono">{file.filename}</span>
          {file.digest !== '' && <SubmissionFileActions file={{ filename: file.filename, digest: file.digest }} />}
        </div>
      ))}
    </Card>
  );
}

export function SubmissionResultsTab({ model }: SubmissionResultsTabProps): React.JSX.Element {
  const record = useDictionary().submissions.record;
  return (
    <div className="space-y-6">
      {model.results.length === 0 ? (
        <EmptyState icon={FileCode} title={record.results.emptyTitle} description={record.results.emptyDescription} />
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
                {interpolate(record.results.dataset, { id: result.datasetId }) + ': ' + phaseLabel(judgingPhaseOf(result), record.status)}
              </div>
            ))}
          </Card>
        </>
      )}
      {model.files.length > 0 && <ResultsFiles files={model.files} />}
    </div>
  );
}
