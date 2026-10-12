import { getRanking, getRankingBoardContests } from '@/app/actions/ranking';
import { getRankingAppearance } from '@/app/actions/rankingAppearance';
import { Card } from '@/components/core/Card';
import { EmptyState } from '@/components/core/EmptyState';
import { SelectField } from '@/components/core/FormField';
import { Grid, Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';
import { RankingTable } from '@/components/contests/contest-detail/RankingTable';
import { RankingLogoCard } from '@/components/ranking/RankingLogoCard';
import { InlineAlert } from '@/components/core/InlineAlert';
import { getDictionary } from '@/i18n';
import { getRankingDiagnostics } from '@/lib/ranking-diagnostics';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

const EMPTY_VALUE = '—';
const TERM_COLOR = 'text-muted-foreground';

interface BoardEntryProps {
  readonly term: string;
  readonly value: string;
}

function BoardEntry({ term, value }: BoardEntryProps): React.JSX.Element {
  return (
    <div>
      <Text as="dt" variant="label" color={TERM_COLOR}>
        {term}
      </Text>
      <Text as="dd" variant="small" className="text-foreground/80">
        {value}
      </Text>
    </div>
  );
}

/** The board's landing: the identity the public scoreboard opens with, and the logo it carries. */
export default async function RankingBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ contest?: string }>;
}): Promise<React.JSX.Element> {
  const [{ locale }, effective] = await Promise.all([
    params,
    authorizeRoutePage('ranking.board'),
  ]);
  const copy = (await getDictionary(locale)).ranking;
  // WHY the contest is resolved before the appearance read: a deployment with no
  // contest yet still has to render the identity card, so the board below it must be
  // able to say "nothing to show" rather than fail the whole page.
  const contests = await getRankingBoardContests();
  const { contest } = await searchParams;
  const requested = Number.parseInt(contest ?? '', 10);
  const selected = contests.find((entry) => entry.id === requested) ?? contests[0] ?? null;
  const [appearance, board, diagnostics] = await Promise.all([
    getRankingAppearance(),
    selected === null ? Promise.resolve(null) : getRanking(selected.id),
    getRankingDiagnostics(),
  ]);
  const accessValue =
    appearance.accessMode === 'protected'
      ? copy.appearance.accessProtected
      : copy.appearance.accessPublic;
  const boardHint =
    appearance.accessMode === 'protected' ? copy.board.hintProtected : copy.board.hint;
  return (
    <Stack gap={6}>
      <Card className="space-y-4">
        <Text as="h2" variant="h3">
          {copy.board.title}
        </Text>
        <Text variant="muted">{boardHint}</Text>
        <Grid as="dl" cols={2} gap={3} className="text-sm">
          <BoardEntry term={copy.appearance.titleField} value={appearance.title || EMPTY_VALUE} />
          <BoardEntry term={copy.appearance.subtitleField} value={appearance.subtitle || EMPTY_VALUE} />
          <BoardEntry
            term={copy.appearance.organisationField}
            value={appearance.organisation || EMPTY_VALUE}
          />
          <BoardEntry term={copy.appearance.accessField} value={accessValue} />
        </Grid>
      </Card>
      <Card className="space-y-4">
        <Text as="h2" variant="h3">
          {copy.users.title}
        </Text>
        {/*
          The service counts the rows it had to drop, and this is the only place that
          counter reaches a human. It sits above the board because it explains what the
          board is missing. Unreachable renders as its own warning, never as a clean
          board: collapsing "could not ask" into "nothing dropped" would hide exactly
          the problem this card exists to surface.
        */}
        {diagnostics.reachable ? (
          diagnostics.skippedOverrides > 0 || diagnostics.skippedSubchanges > 0 ? (
            <InlineAlert tone="warning">
              {`Not applied: ${diagnostics.skippedOverrides} override(s), ${diagnostics.skippedSubchanges} subchange(s). A dropped override shows as a board that never had one.`}
            </InlineAlert>
          ) : null
        ) : (
          <InlineAlert tone="warning">
            {`Applied-changes report unavailable (${diagnostics.reason}). The board below may omit rows a dropped override would explain.`}
          </InlineAlert>
        )}
        {contests.length === 0 ? (
          <EmptyState title={copy.users.empty} description={copy.users.hint} />
        ) : (
          <>
            {/*
              A plain GET form, so the choice works before hydration and the URL stays
              shareable — an operator can send a colleague the board they are looking at.
              The label reuses the override form's wording: it is the same question.
            */}
            <form method="get" className="flex items-end gap-2">
              <SelectField
                id="ranking-board-contest"
                label={copy.overrides.contestId}
                name="contest"
                defaultValue={String(selected?.id ?? '')}
              >
                {contests.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    #{entry.id} — {entry.name}
                  </option>
                ))}
              </SelectField>
              <button type="submit" className="h-9 rounded-md border border-border px-3 text-sm">
                {copy.overrides.chooseContest}
              </button>
            </form>
            <RankingTable ranking={board} />
          </>
        )}
      </Card>
      <RankingLogoCard canManage={effective.has('ranking:update')} />
    </Stack>
  );
}
