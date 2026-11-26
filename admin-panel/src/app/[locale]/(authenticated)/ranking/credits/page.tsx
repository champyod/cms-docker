import { getRankingAppearance, submitRankingCredits } from '@/app/actions/rankingAppearance';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { TextareaField } from '@/components/core/FormField';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';
import { getDictionary } from '@/i18n';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

const CREDIT_ROWS = 12;

// Plain server form: the credit list is saved apart from the appearance columns so neither clears the other.
export default async function RankingCreditsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.JSX.Element> {
  const [{ locale }, effective] = await Promise.all([
    params,
    authorizeRoutePage('ranking.credits'),
  ]);
  const copy = (await getDictionary(locale)).ranking;
  const appearance = await getRankingAppearance();
  const canEdit = effective.has('ranking:appearance');
  return (
    <Stack gap={6}>
      {canEdit ? (
        <Card className="space-y-4">
          <form action={submitRankingCredits} className="space-y-4">
            <Text as="h2" variant="h3">
              {copy.credits.title}
            </Text>
            <TextareaField
              id="ranking-credits"
              label={copy.credits.field}
              hint={copy.credits.hint}
              name="credits"
              rows={CREDIT_ROWS}
              defaultValue={appearance.credits}
              className="font-mono"
            />
            <Button type="submit" variant="positive">
              {copy.credits.save}
            </Button>
          </form>
        </Card>
      ) : null}
    </Stack>
  );
}
