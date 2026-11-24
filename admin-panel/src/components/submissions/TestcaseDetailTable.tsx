'use client';

import type { Dictionary } from '@/lib/dictionary';
import { interpolate } from '@/lib/interpolate';

import { Fragment, useState } from 'react';
import { ClipboardList } from 'lucide-react';

import { Badge } from '@/components/core/Badge';
import { EmptyState } from '@/components/core/EmptyState';
import { InlineAlert } from '@/components/core/InlineAlert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/core/Table';
import { RowExpandAction } from '@/components/list/RowExpandAction';
import { withBasePath } from '@/lib/base-path';
import type {
  SubmissionEvaluationModel,
  SubmissionTestcaseDetailModel,
} from '@/lib/evaluation-read-model-types';

type EvaluationRow = SubmissionEvaluationModel['evaluations'][number];

export interface TestcaseDetailTableProps {
  readonly model: SubmissionEvaluationModel;
  /** False keeps the row data visible but never asks the route for the gated bytes. */
  readonly canReadTestcase: boolean;
  /** common.notSet: a cell or block whose value the record does not hold. */
  readonly missing: string;
  /** The table's own words: columns, block labels, empty state. */
  readonly copy: Dictionary['submissions']['record']['testcases'];
}

const DETAIL_COLUMN_COUNT = 5;
const BYTES_PER_MEBIBYTE = 1024 * 1024;

function text(value: string | null | undefined, missing: string): string {
  if (value === null || value === undefined || value === '') return missing;
  return value;
}

function testcaseLabel(row: EvaluationRow): string {
  return row.testcaseName ?? `Testcase #${row.testcaseId}`;
}

function timeText(seconds: number | null, missing: string): string {
  return seconds === null ? missing : `${seconds.toFixed(3)}s`;
}

function memoryText(bytes: string | null, missing: string): string {
  if (bytes === null) return missing;
  const value = Number(bytes);
  if (!Number.isFinite(value)) return bytes;
  return `${(value / BYTES_PER_MEBIBYTE).toFixed(2)} MiB`;
}

// The service writes the outcome as a score, so only a positive score earns the pass tone.
function verdictVariant(outcome: string | null): 'success' | 'destructive' | 'neutral' {
  if (outcome === null) return 'neutral';
  const score = Number(outcome);
  if (!Number.isFinite(score)) return 'neutral';
  return score > 0 ? 'success' : 'destructive';
}

function DetailBlock({ label, body, emptyLabel }: {
  readonly label: string;
  readonly body: string | null;
  readonly emptyLabel: string;
}): React.JSX.Element {
  return (
    <div className="space-y-1">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</h4>
      {body === null || body === '' ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-background p-3 font-mono text-xs">
          {body}
        </pre>
      )}
    </div>
  );
}

// An unreadable testcase is a permission boundary, so the table names the key.
function HiddenTestcaseData(): React.JSX.Element {
  return (
    <InlineAlert tone="info" density="compact">
      Hidden: requires testcase:read
    </InlineAlert>
  );
}

function TestcaseDetailBody({ detail, loading, error, missing, copy }: {
  readonly detail: SubmissionTestcaseDetailModel | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly missing: string;
  readonly copy: Dictionary['submissions']['record']['testcases'];
}): React.JSX.Element {
  if (loading) return <p role="status" className="text-sm text-muted-foreground">{copy.loading}</p>;
  if (error !== null) return <InlineAlert tone="destructive" density="compact">{error}</InlineAlert>;
  if (detail === null) return <p className="text-sm text-muted-foreground">{copy.noDetail}</p>;
  if (!detail.testcaseReadable) return <HiddenTestcaseData />;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <DetailBlock label={copy.input} body={detail.input} emptyLabel={missing} />
      <DetailBlock label={copy.expectedOutput} body={detail.expectedOutput} emptyLabel={missing} />
      <DetailBlock label={copy.submissionOutput} body={detail.output} emptyLabel={copy.notStored} />
    </div>
  );
}

function TestcaseRow({ row, expanded, onToggle, missing, copy }: {
  readonly row: EvaluationRow;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly missing: string;
  readonly copy: Dictionary['submissions']['record']['testcases'];
}): React.JSX.Element {
  const label = testcaseLabel(row);
  return (
    <TableRow className="cursor-pointer" aria-expanded={expanded} onClick={onToggle}>
      <TableCell className="font-medium">{label}</TableCell>
      <TableCell>
        <Badge variant={verdictVariant(row.outcome)}>{text(row.outcome, missing)}</Badge>
      </TableCell>
      <TableCell className="text-right font-mono text-xs tabular-nums">{timeText(row.executionTime, missing)}</TableCell>
      <TableCell className="text-right font-mono text-xs tabular-nums">{memoryText(row.executionMemory, missing)}</TableCell>
      <TableCell className="text-right">
        <RowExpandAction
          expanded={expanded}
          ariaLabel={interpolate(copy.toggleDetails, { testcase: label })}
          onToggle={onToggle}
        />
      </TableCell>
    </TableRow>
  );
}

/** Opening a row fetches that testcase's inputs from the gated per-testcase route. */
export function TestcaseDetailTable({ model, canReadTestcase, missing, copy }: TestcaseDetailTableProps): React.JSX.Element {
  const [expandedTestcaseId, setExpandedTestcaseId] = useState<number | null>(null);
  const [detail, setDetail] = useState<SubmissionTestcaseDetailModel | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleRow = async (row: EvaluationRow): Promise<void> => {
    if (expandedTestcaseId === row.testcaseId) {
      setExpandedTestcaseId(null);
      return;
    }
    setExpandedTestcaseId(row.testcaseId);
    setDetail(null);
    setError(null);
    // Without the key the route returns the same hidden payload, so the reader is told without a round trip.
    if (!canReadTestcase) return;
    setLoading(true);
    try {
      const response = await fetch(withBasePath(`/api/submissions/${model.submissionId}/testcase/${row.testcaseId}`));
      const payload = await response.json() as SubmissionTestcaseDetailModel & { error?: string };
      if (!response.ok) {
        setError(payload.error ?? copy.loadFailed);
        return;
      }
      setDetail(payload);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : copy.loadFailed);
    } finally {
      setLoading(false);
    }
  };

  if (model.evaluations.length === 0) {
    return (
      <EmptyState
        icon={ClipboardList}
        title={copy.emptyTitle}
        description={copy.emptyDescription}
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{copy.columns.testcase}</TableHead>
          <TableHead>{copy.columns.verdict}</TableHead>
          <TableHead className="text-right">{copy.columns.time}</TableHead>
          <TableHead className="text-right">{copy.columns.memory}</TableHead>
          <TableHead className="w-12 text-right">
            <span className="sr-only">{copy.columns.details}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {model.evaluations.map((row) => {
          const expanded = expandedTestcaseId === row.testcaseId;
          return (
            <Fragment key={row.id}>
              <TestcaseRow row={row} expanded={expanded} onToggle={() => { void toggleRow(row); }} missing={missing} copy={copy} />
              {expanded && (
                <TableRow>
                  <TableCell colSpan={DETAIL_COLUMN_COUNT} className="bg-muted/40">
                    {canReadTestcase
                      ? <TestcaseDetailBody detail={detail} loading={loading} error={error} missing={missing} copy={copy} />
                      : <HiddenTestcaseData />}
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}
