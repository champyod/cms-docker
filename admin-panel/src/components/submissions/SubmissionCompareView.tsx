'use client';

import { useEffect, useState } from 'react';

import { getFileByDigest } from '@/app/actions/statements';
import { Card } from '@/components/core/Card';
import { InlineAlert } from '@/components/core/InlineAlert';
import { useDictionary } from '@/hooks/useDictionary';
import type { SubmissionPreviousModel, SubmissionSourceModel } from '@/lib/evaluation-read-model-types';
import { interpolate } from '@/lib/interpolate';
import { diffLines, type LineDiffRow } from '@/lib/line-diff';
import { cn } from '@/lib/utils';

import { decodeBase64Source } from './SubmissionFileActions';

export interface SubmissionCompareViewProps {
  /** Null when the current submission stores no file at all. */
  readonly current: SubmissionSourceModel | null;
  readonly previous: SubmissionPreviousModel;
}

type ReadableSource = Extract<SubmissionSourceModel, { sourceReadable: true }>;

function readable(source: SubmissionSourceModel | null): ReadableSource | null {
  return source !== null && source.sourceReadable ? source : null;
}

/**
 * The current and previous sources side by side, aligned by a line-level diff.
 *
 * Why the bytes are fetched here and not in the read model: both sources are
 * content-addressed fsobjects, so the server hands over the digests and the
 * browser asks for the two it actually renders through the existing digest gate.
 */
export function SubmissionCompareView({ current, previous }: SubmissionCompareViewProps): React.JSX.Element {
  const record = useDictionary().submissions.record;
  const compare = record.compare;
  const source = record.source;
  const [rows, setRows] = useState<readonly LineDiffRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentRef = readable(current);
  const previousRef = readable(previous.source);

  useEffect(() => {
    if (currentRef === null || previousRef === null) return;
    let cancelled = false;
    void (async () => {
      try {
        const [before, after] = await Promise.all([
          getFileByDigest(previousRef.digest),
          getFileByDigest(currentRef.digest),
        ]);
        if (cancelled) return;
        if (before === null || after === null) {
          setError(source.noContents);
          return;
        }
        setRows(diffLines(decodeBase64Source(before.data), decodeBase64Source(after.data)));
      } catch (cause: unknown) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : compare.fetchFailed);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentRef, previousRef, source.noContents, compare.fetchFailed]);

  const added = rows?.filter((row) => row.kind === 'added').length ?? 0;
  const removed = rows?.filter((row) => row.kind === 'removed').length ?? 0;

  return (
    <Card className="space-y-3">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{compare.title}</h3>
      {current === null || previous.source === null ? (
        <InlineAlert tone="info" density="compact">{source.empty}</InlineAlert>
      ) : !current.sourceReadable || !previous.source.sourceReadable ? (
        <InlineAlert tone="info" density="compact">{source.hidden}</InlineAlert>
      ) : error !== null ? (
        <InlineAlert tone="destructive" density="compact">{error}</InlineAlert>
      ) : rows === null ? (
        <p role="status" className="text-sm text-muted-foreground">{compare.loading}</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {added === 0 && removed === 0
              ? compare.equal
              : interpolate(compare.summary, { added, removed })}
          </p>
          <div className="overflow-auto rounded-lg border border-border font-mono text-xs">
            <div className="grid grid-cols-2 border-b border-border bg-muted/40 px-2 py-1 font-medium">
              <span className="truncate">{interpolate(compare.previous, { id: previous.submissionId })}</span>
              <span className="truncate">{interpolate(compare.current, { id: current.submissionId })}</span>
            </div>
            {rows.map((row, index) => (
              <div key={row.kind + '-' + index} className="grid grid-cols-2">
                <div className={cn('flex gap-2 whitespace-pre-wrap break-words border-r border-border px-2', row.kind === 'removed' && 'bg-destructive/10')}>
                  <span className="w-10 shrink-0 select-none text-right text-muted-foreground">{row.leftNumber ?? ''}</span>
                  <span>{row.left ?? ''}</span>
                </div>
                <div className={cn('flex gap-2 whitespace-pre-wrap break-words px-2', row.kind === 'added' && 'bg-success/10')}>
                  <span className="w-10 shrink-0 select-none text-right text-muted-foreground">{row.rightNumber ?? ''}</span>
                  <span>{row.right ?? ''}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
