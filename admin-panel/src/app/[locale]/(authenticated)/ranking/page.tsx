import { getRankingAppearance } from '@/app/actions/rankingAppearance';
import { RankingLogoCard } from '@/components/ranking/RankingLogoCard';
import { getDictionary } from '@/i18n';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

const CARD_CLASS = 'space-y-4 rounded-2xl border border-border bg-card p-6';
const TERM_CLASS = 'text-xs font-bold uppercase text-muted-foreground';

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
  return (
    <div className="space-y-6">
      <section className={CARD_CLASS}>
        <h2 className="text-lg font-semibold text-foreground">{copy.board.title}</h2>
        <p className="text-sm text-muted-foreground">{copy.board.hint}</p>
        <dl className="grid gap-3 md:grid-cols-2 text-sm">
          <div>
            <dt className={TERM_CLASS}>{copy.appearance.titleField}</dt>
            <dd className="text-foreground">{appearance.title || '—'}</dd>
          </div>
          <div>
            <dt className={TERM_CLASS}>{copy.appearance.subtitleField}</dt>
            <dd className="text-foreground">{appearance.subtitle || '—'}</dd>
          </div>
          <div>
            <dt className={TERM_CLASS}>{copy.appearance.organisationField}</dt>
            <dd className="text-foreground">{appearance.organisation || '—'}</dd>
          </div>
          <div>
            <dt className={TERM_CLASS}>{copy.appearance.accessField}</dt>
            <dd className="text-foreground">
              {appearance.accessMode === 'protected'
                ? copy.appearance.accessProtected
                : copy.appearance.accessPublic}
            </dd>
          </div>
        </dl>
      </section>

      <RankingLogoCard canManage={effective.has('ranking:update')} />
    </div>
  );
}
