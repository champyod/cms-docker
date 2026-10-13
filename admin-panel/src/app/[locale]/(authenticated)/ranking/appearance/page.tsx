import { getRankingAppearance } from '@/app/actions/rankingAppearance';
import { Card } from '@/components/core/Card';
import { Stack } from '@/components/core/Layout';
import { AppearanceForm } from '@/components/ranking/appearance/AppearanceForm';
import { buildAppearanceSections } from '@/components/ranking/appearance/appearanceSchema';
import { getDictionary } from '@/i18n';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

export default async function RankingAppearancePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.JSX.Element> {
  const [{ locale }, effective] = await Promise.all([
    params,
    authorizeRoutePage('ranking.appearance'),
  ]);
  const copy = (await getDictionary(locale)).ranking;
  const appearance = await getRankingAppearance();
  const canEdit = effective.has('ranking:appearance');
  return (
    <Stack gap={6}>
      {canEdit ? (
        <Card className="space-y-4">
          <AppearanceForm
            copy={copy.appearance}
            appearance={appearance}
            sections={buildAppearanceSections(copy.appearance)}
          />
        </Card>
      ) : null}
    </Stack>
  );
}
