import { getRankingAppearance, submitRankingAppearance } from '@/app/actions/rankingAppearance';
import { getDictionary } from '@/i18n';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

const FIELD_CLASS = 'mt-1 w-full rounded-xl border border-white/5 bg-black/40 px-3 py-2 text-white';
const CARD_CLASS = 'space-y-4 rounded-2xl border border-white/10 bg-white/10 p-6 backdrop-blur-xl';
const LABEL_CLASS = 'block text-sm text-white/70';

/**
 * Why a plain server form: the appearance writes one row and must work before
 * hydration, so a client component would buy state the page does not use. The credit
 * list is deliberately absent here — it is edited on its own page so one form cannot
 * clear a field the other no longer posts.
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
  return (
    <div className="space-y-6">
      {canEdit ? (
        <form action={submitRankingAppearance} className={CARD_CLASS}>
          <h2 className="text-lg font-semibold text-white">{copy.appearance.title}</h2>
          <label className={LABEL_CLASS}>
            {copy.appearance.titleField}
            <input name="title" defaultValue={appearance.title} className={FIELD_CLASS} />
          </label>
          <label className={LABEL_CLASS}>
            {copy.appearance.subtitleField}
            <input name="subtitle" defaultValue={appearance.subtitle} className={FIELD_CLASS} />
          </label>
          <label className={LABEL_CLASS}>
            {copy.appearance.organisationField}
            <input name="organisation" defaultValue={appearance.organisation} className={FIELD_CLASS} />
          </label>
          <label className={LABEL_CLASS}>
            {copy.appearance.accessField}
            <select name="accessMode" defaultValue={appearance.accessMode} className={FIELD_CLASS}>
              <option value="public">{copy.appearance.accessPublic}</option>
              <option value="protected">{copy.appearance.accessProtected}</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-white/70">
            <input type="checkbox" name="showIdColumn" defaultChecked={appearance.showIdColumn} />
            {copy.appearance.showIdColumn}
          </label>
          <label className={LABEL_CLASS}>
            {copy.appearance.footerField}
            <input name="footerText" defaultValue={appearance.footerText} className={FIELD_CLASS} />
          </label>
          <label className={LABEL_CLASS}>
            {copy.appearance.creditsField}
            <input name="creditsText" defaultValue={appearance.creditsText} className={FIELD_CLASS} />
          </label>
          <button type="submit" className="rounded-xl bg-indigo-500/20 px-4 py-2 text-indigo-300">
            {copy.appearance.save}
          </button>
        </form>
      ) : null}
    </div>
  );
}
