'use client';

import { Fragment, useState } from 'react';
import { ChevronDown, ChevronUp, ClipboardList } from 'lucide-react';

import { Badge } from '@/components/core/Badge';
import { EmptyState } from '@/components/core/EmptyState';
import { InlineAlert } from '@/components/core/InlineAlert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/core/Table';
import type {
  SubmissionEvaluationModel,
  SubmissionTestcaseDetailModel,
} from '@/lib/evaluation-read-model-types';

type EvaluationRow = SubmissionEvaluationModel['evaluations'][number];

export interface TestcaseDetailTableProps {
  readonly model: SubmissionEvaluationModel;
}

const DETAIL_COLUMN_COUNT = 5;
const BYTES_PER_MEBIBYTE = 1024 * 1024;
const TOGGLE_BUTTON_CLASS =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground';

function text(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return value;
}

function testcaseLabel(row: EvaluationRow): string {
  return row.testcaseName ?? `Testcase #${row.testcaseId}`;
}

function timeText(seconds: number | null): string {
  return seconds === null ? '—' : `${seconds.toFixed(3)}s`;
}

function memoryText(bytes: string | null): string {
  if (bytes === null) return '—';
  const value = Number(bytes);
  if (!Number.isFinite(value)) return bytes;
  return `${(value / BYTES_PER_MEBIBYTE).toFixed(2)} MiB`;
}

// Why parse the outcome: the evaluation service writes it as a score value
// ("1.0", "0.0"), so a positive score earns the pass tone and anything else —
// including a non-numeric manager outcome — stays neutral rather than red.
function verdictVariant(outcome: string | null): 'success' | 'destructive' | 'neutral' {
  if (outcome === null) return 'neutral';
  const score = Number(outcome);
  if (!Number.isFinite(score)) return 'neutral';
  return score > 0 ? 'success' : 'destructive';
}

function DetailBlock({ label, body, emptyLabel = '—' }: {
  readonly label: string;
  readonly body: string | null;
  readonly emptyLabel?: string;
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

function TestcaseDetailBody({ detail, loading, error }: {
  readonly detail: SubmissionTestcaseDetailModel | null;
  readonly loading: boolean;
  readonly error: string | null;
}): React.JSX.Element {
  if (loading) return <p role="status" className="text-sm text-muted-foreground">Loading testcase…</p>;
  if (error !== null) return <InlineAlert tone="destructive" density="compact">{error}</InlineAlert>;
  if (detail === null) return <p className="text-sm text-muted-foreground">No testcase detail.</p>;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <DetailBlock label="Input" body={detail.input} />
      <DetailBlock label="Expected output" body={detail.expectedOutput} />
      <DetailBlock label="Submission output" body={detail.output} emptyLabel="Not stored" />
    </div>
  );
}

function TestcaseRow({ row, expanded, onToggle }: {
  readonly row: EvaluationRow;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}): React.JSX.Element {
  const label = testcaseLabel(row);
  return (
    <TableRow className="cursor-pointer" aria-expanded={expanded} onClick={onToggle}>
      <TableCell className="font-medium">{label}</TableCell>
      <TableCell>
        <Badge variant={verdictVariant(row.outcome)}>{text(row.outcome)}</Badge>
      </TableCell>
      <TableCell className="text-right font-mono text-xs tabular-nums">{timeText(row.executionTime)}</TableCell>
      <TableCell className="text-right font-mono text-xs tabular-nums">{memoryText(row.executionMemory)}</TableCell>
      <TableCell className="text-right">
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`Toggle details for ${label}`}
          className={TOGGLE_BUTTON_CLASS}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </TableCell>
    </TableRow>
  );
}

/**
 * One row per testcase; opening a row fetches that testcase's input, expected
 * output and stored output from the gated per-testcase route.
 */
export function TestcaseDetailTable({ model }: TestcaseDetailTableProps): React.JSX.Element {
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
    setLoading(true);
    try {
      const response = await fetch(`/api/submissions/${model.submissionId}/testcase/${row.testcaseId}`);
      const payload = await response.json() as SubmissionTestcaseDetailModel & { error?: string };
      if (!response.ok) {
        setError(payload.error ?? 'Could not load this testcase.');
        return;
      }
      setDetail(payload);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Could not load this testcase.');
    } finally {
      setLoading(false);
    }
  };

  if (model.evaluations.length === 0) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="No testcase evaluations"
        description="Per-testcase outcomes appear once the submission has been evaluated."
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Testcase</TableHead>
          <TableHead>Verdict</TableHead>
          <TableHead className="text-right">Time</TableHead>
          <TableHead className="text-right">Memory</TableHead>
          <TableHead className="w-12 text-right">
            <span className="sr-only">Details</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {model.evaluations.map((row) => {
          const expanded = expandedTestcaseId === row.testcaseId;
          return (
            <Fragment key={row.id}>
              <TestcaseRow row={row} expanded={expanded} onToggle={() => { void toggleRow(row); }} />
              {expanded && (
                <TableRow>
                  <TableCell colSpan={DETAIL_COLUMN_COUNT} className="bg-muted/40">
                    <TestcaseDetailBody detail={detail} loading={loading} error={error} />
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
