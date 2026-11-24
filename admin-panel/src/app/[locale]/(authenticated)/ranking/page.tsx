import { getRanking, getRankingBoardContests } from '@/app/actions/ranking';
import { getRankingAppearance } from '@/app/actions/rankingAppearance';
import { Button } from '@/components/core/Button';
import { SectionCard } from '@/components/core/SectionCard';
import { EmptyState } from '@/components/core/EmptyState';
import { SelectField } from '@/components/core/FormField';
import { DetailPage } from '@/components/patterns/DetailPage';
import { RankingBoardSurface } from '@/components/ranking/RankingBoardSurface';
import { RankingDiagnosticsCard } from '@/components/ranking/RankingDiagnosticsCard';
import { RankingLogoCard } from '@/components/ranking/RankingLogoCard';
import { getDictionary } from '@/i18n';
import { LiveRefresh } from '@/lib/live/live-refresh';
import { getRankingDiagnostics } from '@/lib/ranking-diagnostics';
import { readShownContestId } from '@/lib/ranking-shown';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';


export default async function RankingBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ contest?: string }>;
}): Promise<React.JSX.Element> {
  const [{ locale }, effective] = await Promise.all([
    params,
    authorizeRoutePage('ranking.board'),
  ]);
  const dictionary = await getDictionary(locale);
  const copy = dictionary.ranking;
  // A deployment with no contest yet still renders the identity facts, so the standings must be able to say nothing rather than fail the page.
  const contests = await getRankingBoardContests();
  const { contest } = await searchParams;
  const requested = Number.parseInt(contest ?? '', 10);
  const selected = contests.find((entry) => entry.id === requested) ?? contests[0] ?? null;
  const [appearance, board, diagnostics, shownContestId] = await Promise.all([
    getRankingAppearance(),
    selected === null ? Promise.resolve(null) : getRanking(selected.id),
    getRankingDiagnostics(),
    readShownContestId(),
  ]);
  // The contest the board serves is decided by the config, so it is read from there and not from the appearance row.
  const named = contests.find((entry) => entry.id === shownContestId) ?? null;
  const accessValue =
    appearance.accessMode === 'protected'
      ? copy.appearance.accessProtected
      : copy.appearance.accessPublic;
  return (
    <DetailPage
      // The module shell above renders the title, the description and the trail.
      ownsHeader={false}
      // shell-title-exempt: the board's name comes from its appearance settings, which the module shell cannot read
      title={appearance.displayName || appearance.title || named?.name || copy.board.title}
      state={
        <SectionCard title={copy.diagnostics.title}>
          <RankingDiagnosticsCard diagnostics={diagnostics} copy={copy.diagnostics} />
        </SectionCard>
      }
      freshness={
        <>
          <LiveRefresh url="/api/ranking/stream" />
          {/* The board is pushed rather than polled, so "how old is this" has one answer here. */}
          <span>Live: the board refreshes as ranking rows change.</span>
        </>
      }
      facts={[
        { term: copy.appearance.displayNameField, value: appearance.displayName || dictionary.common.notSet },
        { term: copy.shown.contestField, value: named?.name ?? copy.shown.contestNone },
        { term: copy.appearance.titleField, value: appearance.title || dictionary.common.notSet },
        { term: copy.appearance.subtitleField, value: appearance.subtitle || dictionary.common.notSet },
        { term: copy.appearance.organisationField, value: appearance.organisation || dictionary.common.notSet },
        { term: copy.appearance.accessField, value: accessValue },
      ]}
    >
      <div className="space-y-4">
        <SectionCard title={copy.users.title}>
          {contests.length === 0 ? (
            <EmptyState title={copy.users.empty} description={copy.users.hint} />
          ) : (
            <>
              {/*
                A plain GET form, so the choice works before hydration and the URL stays
                shareable — an operator can send a colleague the board they are looking at.
                WHY its own wording rather than the override form's: this picks which board to
                preview, so it neither shows a target nor overrides one, and borrowing either
                surface's label would read as one of them.
              */}
              <form method="get" className="space-y-2">
                <div className="flex items-end gap-2">
                  <SelectField
                    id="ranking-board-contest"
                    label={copy.board.previewContestField}
                    name="contest"
                    defaultValue={String(selected?.id ?? '')}
                  >
                    {contests.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        #{entry.id}: {entry.name}
                      </option>
                    ))}
                  </SelectField>
                  <Button type="submit" size="sm" variant="secondary">
                    {copy.board.previewContestSubmit}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{copy.board.previewContestHint}</p>
              </form>
              <RankingBoardSurface
                ranking={board}
                graphTitle="Score Progress Overview (First Board Page)"
              />
            </>
          )}
        </SectionCard>
        <RankingLogoCard
          canManage={effective.has('ranking:update')}
          displayName={appearance.displayName || appearance.title || named?.name || ''}
        />
      </div>
    </DetailPage>
  );
}
