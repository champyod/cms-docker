import { DefinitionEntry } from '@/components/core/DefinitionEntry';
import { InlineAlert } from '@/components/core/InlineAlert';
import { Grid } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';
import type { Dictionary } from '@/lib/dictionary';
import type { RankingDiagnostics } from '@/lib/ranking-diagnostics';

export interface RankingDiagnosticsCardProps {
  readonly diagnostics: RankingDiagnostics;
  readonly copy: Dictionary['ranking']['diagnostics'];
}

/** The muted tone the section headings and their terms share. */
const TERM_COLOR = 'text-muted-foreground';

interface Counter {
  readonly term: string;
  readonly value: number;
}

/**
 * What the ranking service could not apply, counted per cause.
 *
 * WHY every counter is drawn even at zero: a quiet card cannot tell "nothing was dropped" from
 * "nobody measured it", and the breakdown is the whole point — one number covering four causes
 * made a hide the operator had just applied read exactly like a data fault (466 dropped rows on
 * prod, all of them the operator's own contest hide).
 *
 * WHY unreachable is its own strip rather than zeros: collapsing "could not ask" into "nothing
 * dropped" would hide the problem this card exists to surface.
 *
 * WHY a cause the service does not report reads as "not reported": the counter has not been
 * measured, so drawing it as zero would report a number nobody sent.
 */
export function RankingDiagnosticsCard({
  diagnostics,
  copy,
}: RankingDiagnosticsCardProps): React.JSX.Element {
  if (!diagnostics.reachable) {
    return (
      <div className="space-y-3">
        <Text as="h3" variant="label">
          {copy.title}
        </Text>
        <InlineAlert tone="warning">
          {copy.unreachable.replace('{reason}', diagnostics.reason)}
        </InlineAlert>
      </div>
    );
  }

  const subchangeCauses = diagnostics.subchangeCauses;
  const hideCauses = diagnostics.hideCauses;
  // The two alarms the breakdown exists for. A cause group the service does not report is null,
  // and null is not zero — an unreported counter must not raise an alarm it cannot support.
  const faultCount =
    subchangeCauses === null
      ? 0
      : subchangeCauses.unknownTaskSubchanges + subchangeCauses.orphanSubchanges;
  const staleHideCount =
    hideCauses === null ? 0 : hideCauses.renamedTaskHides + hideCauses.unmatchedTaskHides;
  const summary: readonly Counter[] = [
    { term: copy.overridesLabel, value: diagnostics.skippedOverrides },
    { term: copy.subchangeTotal, value: diagnostics.skippedSubchanges },
  ];
  const subchanges: readonly Counter[] | null =
    subchangeCauses === null
      ? null
      : [
          { term: copy.hiddenTaskSubchanges, value: subchangeCauses.hiddenTaskSubchanges },
          { term: copy.unknownTaskSubchanges, value: subchangeCauses.unknownTaskSubchanges },
          { term: copy.orphanSubchanges, value: subchangeCauses.orphanSubchanges },
        ];
  // The total first: it is the counter the service always reported, and the three causes below it
  // are what partitions that number.
  const hides: readonly Counter[] | null =
    hideCauses === null
      ? null
      : [
          { term: copy.unknownTaskHides, value: hideCauses.unknownTaskHides },
          { term: copy.withheldTaskHides, value: hideCauses.withheldTaskHides },
          { term: copy.renamedTaskHides, value: hideCauses.renamedTaskHides },
          { term: copy.unmatchedTaskHides, value: hideCauses.unmatchedTaskHides },
        ];

  return (
    <div className="space-y-3">
      <Text as="h3" variant="label">
        {copy.title}
      </Text>
      <Text variant="muted">{copy.hint}</Text>
      <Grid as="dl" cols={2} gap={3} className="text-sm">
        {summary.map((counter) => (
          <DefinitionEntry
            key={counter.term}
            term={counter.term}
            value={String(counter.value)}
          />
        ))}
      </Grid>
      <Text as="h4" variant="label" color={TERM_COLOR}>
        {copy.subchangesTitle}
      </Text>
      {subchanges === null ? (
        <Text variant="muted">{copy.notReported}</Text>
      ) : (
        <Grid as="dl" cols={2} gap={3} className="text-sm">
          {subchanges.map((counter) => (
            <DefinitionEntry
              key={counter.term}
              term={counter.term}
              value={String(counter.value)}
              termColor={TERM_COLOR}
            />
          ))}
        </Grid>
      )}
      <Text as="h4" variant="label" color={TERM_COLOR}>
        {copy.hidesTitle}
      </Text>
      {hides === null ? (
        <Text variant="muted">{copy.notReported}</Text>
      ) : (
        <Grid as="dl" cols={2} gap={3} className="text-sm">
          {hides.map((counter) => (
            <DefinitionEntry
              key={counter.term}
              term={counter.term}
              value={String(counter.value)}
              termColor={TERM_COLOR}
            />
          ))}
        </Grid>
      )}
      {faultCount > 0 ? (
        <InlineAlert tone="warning" announce="polite">
          {copy.faultAlert.replace('{count}', String(faultCount))}
        </InlineAlert>
      ) : null}
      {staleHideCount > 0 ? (
        <InlineAlert tone="warning" announce="polite">
          {copy.hideAlert.replace('{count}', String(staleHideCount))}
        </InlineAlert>
      ) : null}
    </div>
  );
}
