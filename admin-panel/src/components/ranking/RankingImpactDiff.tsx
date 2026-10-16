'use client';

import { Card } from '@/components/core/Card';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';
import { InlineAlert } from '@/components/core/InlineAlert';
import type { RankingImpact } from '@/lib/ranking-impact';
import type { Dictionary } from '@/lib/dictionary';

export type RankingOverrideCopy = Dictionary['ranking']['overrides'];

export interface RankingImpactDiffProps {
  readonly copy: RankingOverrideCopy;
  readonly impact: RankingImpact | null;
  readonly loading: boolean;
  readonly failed?: boolean;
}

interface ImpactListProps {
  readonly term: string;
  readonly entries: readonly string[];
}

function ImpactList({ term, entries }: ImpactListProps): React.JSX.Element {
  return (
    <div className="min-w-0">
      <Text as="dt" variant="label">{`${term} · ${entries.length}`}</Text>
      <dd className="text-sm text-foreground/80">
        {entries.map((entry) => (
          <span key={entry} className="block truncate" title={entry}>
            {entry}
          </span>
        ))}
      </dd>
    </div>
  );
}

function impactLists(impact: RankingImpact, copy: RankingOverrideCopy): React.JSX.Element | null {
  const lists = [
    { term: copy.impactColumns, entries: impact.columns },
    { term: copy.impactUsers, entries: impact.users },
    { term: copy.impactTeams, entries: impact.teams },
  ].filter((list) => list.entries.length > 0);
  if (lists.length === 0) return null;
  return (
    <Stack gap={3}>
      {lists.map((list) => (
        <ImpactList key={list.term} term={list.term} entries={list.entries} />
      ))}
    </Stack>
  );
}

function ImpactWarnings({ impact, copy }: { readonly impact: RankingImpact; readonly copy: RankingOverrideCopy }): React.JSX.Element | null {
  if (impact.scopeMismatch) {
    return <InlineAlert tone="warning" density="compact" announce="polite">{copy.impactScopeMismatch}</InlineAlert>;
  }
  if (impact.unknownTarget) {
    return <InlineAlert tone="warning" density="compact" announce="polite">{copy.impactUnknown}</InlineAlert>;
  }
  return null;
}

/**
 * The live column beside the toolbar: what the pending override does to the board.
 *
 * WHY it reads as a column and not a diff of the row: the operator is deciding what the scoreboard
 * will lose, and these are the board's own columns, users and teams the projection would drop — a
 * field-by-field comparison of the override row would answer a question nobody is asking.
 */
export function RankingImpactDiff({ copy, impact, loading, failed = false }: RankingImpactDiffProps): React.JSX.Element {
  return (
    <Card className="space-y-4">
      <Text as="h2" variant="h4">{copy.impactTitle}</Text>
      {failed ? (
        <InlineAlert tone="warning" density="compact" announce="polite">{copy.impactFailed}</InlineAlert>
      ) : loading ? (
        <Text variant="muted">{copy.impactLoading}</Text>
      ) : impact === null ? (
        <Text variant="muted">{copy.impactEmpty}</Text>
      ) : (
        <>
          <Stack as="dl" gap={3}>
            {impactLists(impact, copy)}
          </Stack>
          <ImpactWarnings impact={impact} copy={copy} />
        </>
      )}
    </Card>
  );
}
