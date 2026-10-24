'use client';

import { useMemo } from 'react';

import { Badge } from '@/components/core/Badge';
import { EmptyState } from '@/components/core/EmptyState';
import { ResponsiveTable, type ResponsiveColumn } from '@/components/core/ResponsiveTable';
import type { Dictionary } from '@/lib/dictionary';
import { attributionText, isUnattributed } from '@/lib/ranking-attribution';
import type { RankingHide, RankingHideSource } from '@/lib/ranking-hides';

type RankingCopy = Dictionary['ranking'];

const MUTED = 'text-muted-foreground';
const NO_REASON = '—';

/** The word the rest of the ranking surface already uses for a target kind. */
function kindWord(copy: RankingCopy, kind: string): string {
  if (kind === 'user') return copy.overrides.targetUser;
  if (kind === 'team') return copy.overrides.targetTeam;
  if (kind === 'contest') return copy.overrides.targetContest;
  if (kind === 'task') return copy.overrides.targetTask;
  if (kind === 'ranking') return copy.overrides.targetRanking;
  // An unknown kind is shown as the row spells it rather than hidden: a reader that cannot name a
  // kind must still report that the board is hiding it.
  return kind;
}

/**
 * The target as the board knows it.
 *
 * WHY the label when it resolves: a hide is filed against a key the operator typed or picked, and
 * a key is not a person — the label is what the operator can match to the row that left the board.
 * WHY the key when it does not: the hide names something the projection does not hold, and the key
 * is the only handle the operator has to go and fix it with.
 */
function targetText(hide: RankingHide, copy: RankingCopy): string {
  if (hide.targetKind === 'ranking') return copy.hides.wholeBoard;
  return hide.label ?? hide.targetKey;
}

/**
 * Where one hide came from.
 *
 * WHY the source is a badge and the author is plain text: the two are different facts — which write
 * hid the row, and which operator made it — and an override filed with no author is the case this
 * surface exists to make visible, so it carries the mark the override list also uses.
 */
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
      {isUnattributed(source) ? (
        <Badge variant="amber">{copy.overrides.outsidePanelBadge}</Badge>
      ) : (
        <span className={`font-mono text-xs ${MUTED}`}>{attributionText(source)}</span>
      )}
    </span>
  );
}

function reasonText(hide: RankingHide): string {
  for (const source of hide.sources) {
    if (source.source === 'override' && source.reason !== null && source.reason !== '') return source.reason;
  }
  return NO_REASON;
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
      render: (hide) => <span className={MUTED}>{reasonText(hide)}</span>,
    },
  ];
}

export interface RankingHidesListProps {
  readonly copy: RankingCopy;
  readonly hides: readonly RankingHide[];
}

/**
 * The board's hides, one line per hidden row.
 *
 * WHY a table beside the override list rather than a section inside it: the override list is the
 * ledger of rows the operator filed, while this is the set of rows the board actually drops — it
 * includes hides no override row records, so folding it into the ledger would make a row that does
 * not exist there look like one that does. Both render through the panel's one responsive table so
 * the two cannot drift in selection, empty state or mobile layout.
 */
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
