import { endRankingOverride, getRankingOverrides, saveRankingOverride } from '@/app/actions/rankingOverrides';
import { OverrideForm } from '@/components/ranking/OverrideForm';
import { getDictionary } from '@/i18n';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

const FIELD_CLASS = 'mt-1 w-full rounded-xl border border-border bg-muted/40 px-3 py-2 text-foreground';
const CARD_CLASS = 'space-y-4 rounded-2xl border border-border bg-card p-6';
const LABEL_CLASS = 'block text-sm text-muted-foreground';

/**
 * Why plain server forms: each override writes one row and must work before
 * hydration, so a client component would buy state the page does not use.
 */
export default async function RankingSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.JSX.Element> {
  const [{ locale }, effective] = await Promise.all([
    params,
    authorizeRoutePage('ranking.settings'),
  ]);
  const copy = (await getDictionary(locale)).ranking;
  const overrides = await getRankingOverrides();
  const canOverride = effective.has('ranking:override');
  return (
    <div className="space-y-6">
      <section className={CARD_CLASS}>
        <h2 className="text-lg font-semibold text-foreground">{copy.overrides.title}</h2>
        <p className="text-sm text-muted-foreground">{copy.overrides.hint}</p>
        {canOverride ? <OverrideForm copy={copy.overrides} permissionKeys={[...effective]} locale={locale} /> : null}
        <ul className="divide-y divide-border text-sm text-foreground">
          {overrides.map((override) => (
            <li key={override.id} className="flex flex-wrap items-center gap-3 py-2">
              <span className="font-mono text-muted-foreground">{override.id}</span>
              <span>
                {override.action} {override.targetKind} {override.targetKey}
                {override.value === '' ? null : ` (${override.value})`}
              </span>
              <span className="text-muted-foreground">contest {override.contestId}</span>
              <span className="text-muted-foreground">{override.reason}</span>
              {canOverride ? (
                <form action={endRankingOverride} className="ml-auto flex items-center gap-2">
                  <input type="hidden" name="id" value={override.id} />
                  <input
                    name="reason"
                    required
                    placeholder={copy.overrides.reason}
                    className="rounded-lg border border-border bg-muted/40 px-2 py-1 text-foreground"
                  />
                  <button type="submit" className="rounded-lg bg-red-500/20 px-3 py-1 text-red-300">
                    {copy.overrides.end}
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
