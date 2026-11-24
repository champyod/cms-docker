'use client';

import { useMemo } from 'react';

import { Badge } from '@/components/core/Badge';
import { EmptyState } from '@/components/core/EmptyState';
import { ResponsiveTable, type ResponsiveColumn } from '@/components/core/ResponsiveTable';
import { AttributionMark } from '@/components/ranking/AttributionMark';
import type { Dictionary } from '@/lib/dictionary';
import type { RankingHide, RankingHideSource } from '@/lib/ranking-hides';

type RankingCopy = Dictionary['ranking'];

const MUTED = 'text-muted-foreground';

/** The word the rest of the ranking surface already uses for a target kind. */
function kindWord(copy: RankingCopy, kind: string): string {
  if (kind === 'user') return copy.overrides.targetUser;
  if (kind === 'team') return copy.overrides.targetTeam;
  if (kind === 'contest') return copy.overrides.targetContest;
  if (kind === 'task') return copy.overrides.targetTask;
  if (kind === 'ranking') return copy.overrides.targetRanking;
  // An unknown kind is shown as spelled rather than hidden: the reader must know the board is hiding it.
  return kind;
}

/** The label is what the operator can match to the row; the key is the handle when the projection does not hold it. */
function targetText(hide: RankingHide, copy: RankingCopy): string {
  if (hide.targetKind === 'ranking') return copy.hides.wholeBoard;
  return hide.label ?? hide.targetKey;
}

/** The source and the author are different facts: which write hid the row, and which operator made it. */
function SourceMark({
  source,
  copy,
}: {
  readonly source: RankingHideSource;
  readonly copy: RankingCopy;
}): React.JSX.Element {
  if (source.source === 'participation') {
    return <Badge variant="amber">{copy.hides.sourceParticipation}</Badge>;
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Badge variant="cyan">{copy.hides.sourceOverride}</Badge>
      <AttributionMark row={source} unattributedLabel={copy.overrides.outsidePanelBadge} />
    </span>
  );
}

function reasonText(hide: RankingHide, copy: RankingCopy): string {
  for (const source of hide.sources) {
    if (source.source === 'override' && source.reason !== null && source.reason !== '') return source.reason;
  }
  // The column's empty meaning is a sentence, not a mark, so it reads as a word.
  return copy.hides.noReason;
}

function buildColumns(copy: RankingCopy): ResponsiveColumn<RankingHide>[] {
  return [
    {
      key: 'target',
      header: copy.hides.columnTarget,
      cellClassName: 'max-w-[320px]',
      render: (hide) => (
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {kindWord(copy, hide.targetKind)}
          </span>
          <span className="font-mono text-sm text-foreground">{targetText(hide, copy)}</span>
          {hide.label === null && hide.targetKind !== 'ranking' ? (
            <Badge variant="amber">{copy.hides.unknownTarget}</Badge>
          ) : null}
        </span>
      ),
    },
    {
      key: 'source',
      header: copy.hides.columnSource,
      render: (hide) => (
        <span className="flex flex-wrap items-center gap-2">
          {hide.sources.map((source, index) => (
            <SourceMark key={`${source.source}-${index}`} source={source} copy={copy} />
          ))}
        </span>
      ),
    },
    {
      key: 'reason',
      header: copy.hides.columnReason,
      render: (hide) => <span className={MUTED}>{reasonText(hide, copy)}</span>,
    },
  ];
}

export interface RankingHidesListProps {
  readonly copy: RankingCopy;
  readonly hides: readonly RankingHide[];
}

/** The set the board actually drops, beside the ledger of overrides the operator filed. */
export function RankingHidesList({ copy, hides }: RankingHidesListProps): React.JSX.Element {
  const columns = useMemo(() => buildColumns(copy), [copy]);
  return (
    <ResponsiveTable
      columns={columns}
      rows={[...hides]}
      getRowKey={(hide) => hide.id}
      emptyState={<EmptyState title={copy.hides.empty} />}
    />
  );
}
