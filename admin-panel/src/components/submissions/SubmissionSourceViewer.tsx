'use client';

import { useEffect, useState } from 'react';

import { getFileByDigest } from '@/app/actions/statements';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { InlineAlert } from '@/components/core/InlineAlert';
import { useDictionary } from '@/hooks/useDictionary';
import type { SubmissionPreviousModel, SubmissionSourceModel } from '@/lib/evaluation-read-model-types';
import { interpolate } from '@/lib/interpolate';
import { diffLines, type LineDiffKind, type LineDiffRow } from '@/lib/line-diff';
import { cn } from '@/lib/utils';

import { decodeBase64Source, SubmissionFileActions } from './SubmissionFileActions';
import { highlightedLines } from './source-highlight';

/** Rows the collapsed view shows; the rest of a long file stays one click away. */
const PREVIEW_ROW_COUNT = 12;

// Why no surface class on the scroll box: the code reads as part of the card it sits in, and the
// syntax colours come from the panel's own tokens in globals.css rather than from a bundled theme
// whose background would paint the panel a colour of its own.
const SCROLL_CLASS = 'source-code max-h-96 overflow-auto rounded-lg border border-border p-3';
const ROW_CLASS = 'grid min-h-5 items-start leading-5';
const COMPARE_COLUMNS = 'grid-cols-[2.25rem_2.25rem_1rem_minmax(0,1fr)]';
const SINGLE_COLUMNS = 'grid-cols-[2.25rem_1rem_minmax(0,1fr)]';
const COLLAPSE_FADE_CLASS = 'pointer-events-none absolute inset-x-0 bottom-0 h-8 rounded-b-lg bg-gradient-to-t from-card to-transparent';

const ROW_TONE: Record<LineDiffKind, string> = {
  same: '',
  added: 'bg-success/10',
  removed: 'bg-destructive/10',
};

const MARKER: Record<LineDiffKind, string> = { same: ' ', added: '+', removed: '-' };

const MARKER_TONE: Record<LineDiffKind, string> = {
  same: 'text-transparent',
  added: 'text-success',
  removed: 'text-destructive',
};

type ReadableSource = Extract<SubmissionSourceModel, { sourceReadable: true }>;

interface SourceBytes {
  readonly current: string;
  readonly previous: string | null;
}

interface DiffRow {
  readonly kind: LineDiffKind;
  readonly previousNumber: number | null;
  readonly currentNumber: number | null;
  readonly html: string;
}

export interface SubmissionSourceViewerProps {
  /** Null when the submission stores no file at all. */
  readonly source: SubmissionSourceModel | null;
  /** Null when no earlier submission shares this participation and task. */
  readonly previous?: SubmissionPreviousModel | null;
}

/**
 * The submission's own source, rendered as code with its diff to the previous submission inline.
 *
 * Why one view and not a source viewer beside a comparison: both read the same bytes for the same
 * file, so two panels showed the same code twice and left the reader to line the copies up by eye.
 * Here the previous submission is the gutter — a removed line carries its own number and text
 * where the current source would sit — so one scroll answers "what does this store" and "what did
 * it change" together, and a submission with no predecessor is the same view with a plain gutter.
 * A predecessor that stored no file, or whose file this reader may not open, leaves nothing to
 * diff: the comparison is then a note naming which of the two it is, never a summary of a
 * comparison the panel did not run.
 */
export function SubmissionSourceViewer({ source, previous = null }: SubmissionSourceViewerProps): React.JSX.Element {
  const copy = useDictionary().submissions.record.source;
  const current = readableSource(source);
  const before = readableSource(previous?.source ?? null);
  const { bytes, failed } = useSourceBytes(current, before);
  return (
    <Card className="space-y-3">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{copy.title}</h3>
      <SourceBody
        summary={source}
        bytes={bytes}
        failed={failed}
        previous={previous}
        emptyLabel={copy.empty}
        hiddenLabel={copy.hidden}
        loadingLabel={copy.loading}
      />
    </Card>
  );
}

// Why the digest: the code bytes are a content-addressed fsobject, so the panel asks for them only
// once the viewer is on screen — and asks for the previous submission's in the same pass, so the
// diff never renders against half a comparison.
function useSourceBytes(current: ReadableSource | null, previous: ReadableSource | null): {
  readonly bytes: SourceBytes | null;
  readonly failed: string | null;
} {
  const copy = useDictionary().submissions.record.source;
  const [bytes, setBytes] = useState<SourceBytes | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (current === null) return;
    let cancelled = false;
    void (async () => {
      try {
        const [currentFile, previousFile] = await Promise.all([
          getFileByDigest(current.digest),
          previous === null ? Promise.resolve(null) : getFileByDigest(previous.digest),
        ]);
        if (cancelled) return;
        if (currentFile === null || (previous !== null && previousFile === null)) {
          setFailed(copy.noContents);
          return;
        }
        setBytes({
          current: decodeBase64Source(currentFile.data),
          previous: previousFile === null ? null : decodeBase64Source(previousFile.data),
        });
      } catch (cause: unknown) {
        if (!cancelled) setFailed(cause instanceof Error ? cause.message : copy.noContents);
      }
    })();
    return () => { cancelled = true; };
  }, [current, previous, copy.noContents]);

  return { bytes, failed };
}

// Why a number per side: a line only the previous submission had and a line only this one has are
// the two halves of one change, and a reader has to be able to name either side's line — the same
// reason a unified diff keeps both columns.
function buildRows(bytes: SourceBytes, language: string | null): readonly DiffRow[] {
  const current = highlightedLines(bytes.current, language);
  if (bytes.previous === null) {
    return current.map((html, index) => ({ kind: 'same', previousNumber: null, currentNumber: index + 1, html }));
  }
  const before = highlightedLines(bytes.previous, language);
  return diffLines(bytes.previous, bytes.current).map((row) => ({
    kind: row.kind,
    previousNumber: row.leftNumber,
    currentNumber: row.rightNumber,
    html: rowHtml(row, current, before),
  }));
}

// A removed row shows the previous submission's line, because that is the side of the change the
// line belongs to; every other row shows the line this submission stores.
function rowHtml(row: LineDiffRow, current: readonly string[], before: readonly string[]): string {
  const number = row.kind === 'removed' ? row.leftNumber : row.rightNumber;
  if (number === null) return '';
  return (row.kind === 'removed' ? before[number - 1] : current[number - 1]) ?? '';
}

function SourceBody({ summary, bytes, failed, previous, emptyLabel, hiddenLabel, loadingLabel }: {
  readonly summary: SubmissionSourceModel | null;
  readonly bytes: SourceBytes | null;
  readonly failed: string | null;
  readonly previous: SubmissionPreviousModel | null;
  readonly emptyLabel: string;
  readonly hiddenLabel: string;
  readonly loadingLabel: string;
}): React.JSX.Element {
  if (summary === null) return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  if (!summary.sourceReadable) return <HiddenSource label={hiddenLabel} />;
  if (failed !== null) return <InlineAlert tone="destructive" density="compact">{failed}</InlineAlert>;
  if (bytes === null) return <p role="status" className="text-sm text-muted-foreground">{loadingLabel}</p>;
  return <SourceDiff bytes={bytes} summary={summary} previous={previous} />;
}

// Why an explicit reason: an unreadable file is a permission boundary, so the panel names the key
// instead of rendering an empty viewer that reads as missing data.
function HiddenSource({ label }: { readonly label: string }): React.JSX.Element {
  return (
    <InlineAlert tone="info" density="compact">
      {label}
    </InlineAlert>
  );
}

function NumberCell({ number }: { readonly number: number | null }): React.JSX.Element {
  return <span className="select-none text-right font-mono text-xs text-muted-foreground/70">{number ?? ''}</span>;
}

function DiffRowView({ row, showCompare, wrap }: {
  readonly row: DiffRow;
  readonly showCompare: boolean;
  readonly wrap: boolean;
}): React.JSX.Element {
  return (
    <div data-diff-kind={row.kind} className={cn(ROW_CLASS, showCompare ? COMPARE_COLUMNS : SINGLE_COLUMNS, ROW_TONE[row.kind])}>
      {showCompare && <NumberCell number={row.previousNumber} />}
      <NumberCell number={row.currentNumber} />
      <span className={cn('select-none text-center', MARKER_TONE[row.kind])}>{MARKER[row.kind]}</span>
      <code
        className={cn('font-mono text-xs', wrap ? 'break-words whitespace-pre-wrap' : 'whitespace-pre')}
        dangerouslySetInnerHTML={{ __html: row.html }}
      />
    </div>
  );
}

function DiffSummary({ previous, current, added, removed }: {
  readonly previous: number;
  readonly current: number;
  readonly added: number;
  readonly removed: number;
}): React.JSX.Element {
  const compare = useDictionary().submissions.record.compare;
  return (
    <p className="text-xs text-muted-foreground">
      {interpolate(compare.previous, { id: previous })} → {interpolate(compare.current, { id: current })}
      {' · '}
      {added === 0 && removed === 0 ? compare.equal : interpolate(compare.summary, { added, removed })}
    </p>
  );
}

function SourceDiff({ bytes, summary, previous }: {
  readonly bytes: SourceBytes;
  readonly summary: ReadableSource;
  readonly previous: SubmissionPreviousModel | null;
}): React.JSX.Element {
  const copy = useDictionary().submissions.record.source;
  const compare = useDictionary().submissions.record.compare;
  const [expanded, setExpanded] = useState(false);
  const [wrap, setWrap] = useState(true);

  const showCompare = bytes.previous !== null;
  // Why a state per cause and not a bare "previous or nothing": a predecessor that stored no file
  // and one whose file this reader may not open both leave nothing to diff, and each says so in its
  // own words — the in-place states the two-card view kept. Reporting the comparison summary in
  // either case would assert a result for a comparison the panel never made, which reads to the
  // reviewer as "the sources are equal" and is the one thing this view must not do.
  const previousNote = previous === null || showCompare
    ? null
    : previous.source === null ? 'empty' : 'hidden';
  const rows = buildRows(bytes, summary.language);
  const added = rows.filter((row) => row.kind === 'added').length;
  const removed = rows.filter((row) => row.kind === 'removed').length;
  const truncated = rows.length > PREVIEW_ROW_COUNT;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-xs text-muted-foreground">{summary.filename}</span>
        <div className="flex flex-wrap items-center gap-1">
          <SubmissionFileActions file={{ filename: summary.filename, digest: summary.digest }} />
          <Button variant="ghost" size="sm" aria-pressed={wrap} onClick={() => setWrap(!wrap)}>
            {copy.wrap}
          </Button>
          {truncated && (
            <Button variant="secondary" size="sm" onClick={() => setExpanded(!expanded)}>
              {expanded ? copy.collapse : copy.showFull}
            </Button>
          )}
        </div>
      </div>
      {showCompare && previous !== null && (
        <DiffSummary previous={previous.submissionId} current={summary.submissionId} added={added} removed={removed} />
      )}
      {previousNote !== null && (
        <InlineAlert tone="info" density="compact">
          {previousNote === 'empty' ? compare.previousEmpty : compare.previousHidden}
        </InlineAlert>
      )}
      <div className="relative">
        <div role="region" aria-label={compare.title} className={SCROLL_CLASS}>
          {(expanded || !truncated ? rows : rows.slice(0, PREVIEW_ROW_COUNT)).map((row, index) => (
            <DiffRowView key={`${row.kind}-${index}`} row={row} showCompare={showCompare} wrap={wrap} />
          ))}
        </div>
        {!expanded && truncated && <div aria-hidden="true" className={COLLAPSE_FADE_CLASS} />}
      </div>
    </div>
  );
}

function readableSource(source: SubmissionSourceModel | null): ReadableSource | null {
  return source !== null && source.sourceReadable ? source : null;
}
