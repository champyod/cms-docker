import { getRankingAppearance, submitRankingCredits } from '@/app/actions/rankingAppearance';
import { getDictionary } from '@/i18n';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

const FIELD_CLASS = 'mt-1 w-full rounded-xl border border-border bg-muted/40 px-3 py-2 text-foreground';
const CARD_CLASS = 'space-y-4 rounded-2xl border border-border bg-card p-6';
const LABEL_CLASS = 'block text-sm text-muted-foreground';

/**
 * Why its own page and its own save: the credit list is the one field whose loss is a
 * licence offer rendered wrong, so it is edited apart from the appearance columns
 * rather than inside a form that no longer posts it.
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
  return (
    <div className="space-y-6">
      {canEdit ? (
        <form action={submitRankingCredits} className={CARD_CLASS}>
          <h2 className="text-lg font-semibold text-foreground">{copy.credits.title}</h2>
          <label className={LABEL_CLASS}>
            {copy.credits.field}
            <textarea
              name="credits"
              rows={12}
              defaultValue={appearance.credits}
              className={`${FIELD_CLASS} font-mono`}
            />
          </label>
          <p className="text-xs text-muted-foreground">{copy.credits.hint}</p>
          <button type="submit" className="rounded-xl bg-indigo-500/20 px-4 py-2 text-indigo-300">
            {copy.credits.save}
          </button>
        </form>
      ) : null}
    </div>
  );
}
