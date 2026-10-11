import { getRankingAppearance } from '@/app/actions/rankingAppearance';
import { Card } from '@/components/core/Card';
import { Grid, Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';
import { RankingLogoCard } from '@/components/ranking/RankingLogoCard';
import { getDictionary } from '@/i18n';
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
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.JSX.Element> {
  const [{ locale }, effective] = await Promise.all([
    params,
    authorizeRoutePage('ranking.board'),
  ]);
  const copy = (await getDictionary(locale)).ranking;
  const appearance = await getRankingAppearance();
  const accessValue =
    appearance.accessMode === 'protected'
      ? copy.appearance.accessProtected
      : copy.appearance.accessPublic;
  return (
    <Stack gap={6}>
      <Card className="space-y-4">
        <Text as="h2" variant="h3">
          {copy.board.title}
        </Text>
        <Text variant="muted">{copy.board.hint}</Text>
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
      <RankingLogoCard canManage={effective.has('ranking:update')} />
    </Stack>
  );
}
