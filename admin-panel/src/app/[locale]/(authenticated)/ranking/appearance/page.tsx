import { getRankingAppearance } from '@/app/actions/rankingAppearance';
import { InlineAlert } from '@/components/core/InlineAlert';
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
        <AppearanceForm
          copy={copy.appearance}
          appearance={appearance}
          sections={buildAppearanceSections(copy.appearance)}
        />
      ) : (
        // WHY a strip rather than nothing: the route only needs ranking:read, so a reader
        // without the write key reaches this page, and an empty page reads as a broken one.
        <InlineAlert tone="info" announce="polite">
          {copy.appearance.readOnly}
        </InlineAlert>
      )}
    </Stack>
  );
}
