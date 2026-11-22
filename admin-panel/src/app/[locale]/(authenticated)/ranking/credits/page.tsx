import { getRankingAppearance, submitRankingCredits } from '@/app/actions/rankingAppearance';
import { Button } from '@/components/core/Button';
import { TextareaField } from '@/components/core/FormField';
import { InlineAlert } from '@/components/core/InlineAlert';
import { SettingsPage, type SettingsGroup } from '@/components/patterns/SettingsPage';
import { getDictionary } from '@/i18n';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

const CREDIT_ROWS = 12;

/**
 * The credit list the public scoreboard attributes its licences to.
 *
 * WHY settings and not a form: nothing here describes a record. One group decides what every visitor
 * reads at the foot of the board, and the question a reader arrives with is who a save reaches — so
 * the group states its scope rather than offering a cancel that would contradict the save.
 *
 * WHY the list is saved apart from the appearance page: a plain server form posts only this column,
 * so saving credits cannot clear the title, subtitle or access mode it does not carry.
 */
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
  const groups: readonly SettingsGroup[] = [
    {
      key: 'credits',
      title: copy.credits.title,
      // The field hint, stated once: the group describes the column, and the textarea below it does
      // not repeat the same sentence above the same box.
      description: copy.credits.hint,
      scope:
        'Everyone: the ranking service serves this list with the board, so a save changes the credits every visitor reads.',
      children: canEdit ? (
        <form action={submitRankingCredits} className="space-y-4">
          <TextareaField
            id="ranking-credits"
            label={copy.credits.field}
            name="credits"
            rows={CREDIT_ROWS}
            defaultValue={appearance.credits}
            className="font-mono"
          />
          <Button type="submit" variant="positive">
            {copy.credits.save}
          </Button>
        </form>
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
      title=""
      groups={groups}
    />
  );
}
