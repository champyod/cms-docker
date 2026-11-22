import { getRankingAppearance } from '@/app/actions/rankingAppearance';
import { InlineAlert } from '@/components/core/InlineAlert';
import { SettingsPage, type SettingsGroup } from '@/components/patterns/SettingsPage';
import { AppearanceForm } from '@/components/ranking/appearance/AppearanceForm';
import { buildAppearanceSections } from '@/components/ranking/appearance/appearanceSchema';
import { getDictionary } from '@/i18n';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

/**
 * What the public scoreboard opens with, and the JSON the ranking service reads from it.
 *
 * WHY settings and not a form: nothing here describes a record the panel owns. The page changes how
 * the board behaves for whoever opens it, and the question a reader arrives with is whether a save
 * reaches their screen or everyone's — so the group states its reach instead of offering the cancel
 * a form would imply.
 *
 * WHY one group over all three sections: identity, display and the JSON boxes are one row saved by
 * one write. Separate groups would claim three saves that do not exist, and a save bar per group
 * would be three buttons posting the same values.
 */
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
  const groups: readonly SettingsGroup[] = [
    {
      key: 'appearance',
      title: copy.appearance.title,
      description:
        'The words the board opens with, its access mode, the id column and the theme, score format and perspective tabs the ranking service reads.',
      scope:
        'Everyone: a save rewrites the one appearance row the public board is served from, so every visitor meets the change on their next load.',
      children: canEdit ? (
        <AppearanceForm
          copy={copy.appearance}
          appearance={appearance}
          sections={buildAppearanceSections(copy.appearance)}
        />
      ) : (
        // Why a strip rather than nothing: the route only needs ranking:read, so a reader without
        // the write key reaches this page, and an empty page reads as a broken one.
        <InlineAlert tone="info" announce="polite">
          {copy.appearance.readOnly}
        </InlineAlert>
      ),
    },
  ];
  return (
    <SettingsPage
      // The module shell above renders the title, the description and the trail.
      ownsHeader={false}
      groups={groups}
    />
  );
}
