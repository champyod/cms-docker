import { getRankingOverrideOptions } from '@/app/actions/ranking';
import { getShownTargetChoices, getShownTargets } from '@/app/actions/rankingConfig';
import { getRankingOverrides, type RankingOverride } from '@/app/actions/rankingOverrides';
import { BoardPage, type BoardSection } from '@/components/patterns/BoardPage';
import { RankingConfigSurface } from '@/components/ranking/RankingConfigSurface';
import { RankingHidesList } from '@/components/ranking/RankingHidesList';
import { RankingOverrideList } from '@/components/ranking/RankingOverrideList';
import { RankingOverrideSurface } from '@/components/ranking/RankingOverrideSurface';
import { RankingShardTabs } from '@/components/ranking/RankingShardTabs';
import { getDictionary } from '@/i18n';
import type { Dictionary } from '@/lib/dictionary';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';
import { readBoardHides } from '@/lib/ranking-hides';
import { readOrphanContestIds } from '@/lib/ranking-orphans';
import { readRankingShards, selectShard, type RankingShard } from '@/lib/ranking-shards';

type SearchParams = Record<string, string | string[] | undefined>;
type RankingCopy = Dictionary['ranking'];

function readShardParam(query: SearchParams): string | undefined {
  const raw = query.shard;
  return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * WHY the orphans ride beside the shard's own rows: a row filed under a contest no enabled binding
 * serves never appears in a shard-scoped list, which is exactly why it went unnoticed — the list
 * that is meant to show the operator what applies has to show what silently does not.
 */
function rowsForShard(
  overrides: readonly RankingOverride[],
  shard: RankingShard,
  orphans: ReadonlySet<number>,
): RankingOverride[] {
  return overrides.filter(
    (override) => override.contestId === shard.contestId || orphans.has(override.contestId),
  );
}

/**
 * The shard's overrides: the shard strip, the add surface, then the ledger.
 *
 * WHY the strip is the first row of the section and not a page control: it selects the shard both
 * the override list and the hides list read, so it has to be read before either, and the board
 * keeps its section header for the title and the meaning of the rows.
 */
function OverridesRows({
  copy,
  shards,
  shard,
  overrides,
  orphans,
  options,
  canOverride,
}: {
  readonly copy: RankingCopy;
  readonly shards: readonly RankingShard[];
  readonly shard: RankingShard;
  readonly overrides: readonly RankingOverride[];
  readonly orphans: ReadonlySet<number>;
  readonly options: Awaited<ReturnType<typeof getRankingOverrideOptions>> | null;
  readonly canOverride: boolean;
}): React.JSX.Element {
  return (
    <div className="space-y-4">
      <RankingShardTabs shards={shards} activeShard={shard.shard} copy={copy.overrides} />
      {canOverride && options !== null ? (
        <RankingOverrideSurface
          copy={copy.overrides}
          contestId={shard.contestId}
          targetKind="user"
          targetKey=""
          userKeys={options.userKeys}
          teamKeys={options.teamKeys}
          contestKeys={options.contestKeys}
          taskKeys={options.taskKeys}
        />
      ) : null}
      <RankingOverrideList
        copy={copy.overrides}
        rows={rowsForShard(overrides, shard, orphans)}
        orphanContestIds={[...orphans]}
        canOverride={canOverride}
      />
    </div>
  );
}

/**
 * Three record kinds share this page, and each answers a different question about the same board:
 * which contests it draws, which rows the operator filed over it, and which rows it actually
 * drops. They are not one list — an override row and a participation flag hide a row by different
 * means, and the config decides what is shown before either applies — so the page is a board.
 *
 * WHY the config half sits on this page and not a route of its own: an operator who can only find
 * one of the two surfaces reads the other as the same control.
 */
export default async function RankingOverridesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}): Promise<React.JSX.Element> {
  const [{ locale }, effective, query] = await Promise.all([
    params,
    authorizeRoutePage('ranking.users'),
    searchParams,
  ]);
  const dict = await getDictionary(locale);
  const shards = await readRankingShards();
  const shard = selectShard(shards, readShardParam(query));
  const canOverride = effective.has('ranking:override');

  if (shard === null) {
    return (
      <BoardPage
        // The module shell above renders the title, the description and the trail.
        ownsHeader={false}
        title={dict.navigation.ranking.users.label}
        description={dict.navigation.ranking.users.description}
        state={<p className="text-sm text-muted-foreground">{dict.ranking.overrides.noShards}</p>}
        sections={[]}
      />
    );
  }

  const overrides = await getRankingOverrides();
  const [orphans, options, hides, shownRows, shownChoices] = await Promise.all([
    readOrphanContestIds(overrides),
    canOverride ? getRankingOverrideOptions() : Promise.resolve(null),
    readBoardHides(shard.contestId),
    getShownTargets(),
    getShownTargetChoices(),
  ]);

  const sections: readonly BoardSection[] = [
    {
      key: 'shown',
      title: dict.ranking.shown.title,
      description: dict.ranking.shown.hint,
      rows: (
        <RankingConfigSurface
          copy={dict.ranking.shown}
          rows={shownRows}
          choices={shownChoices}
          canShow={canOverride}
        />
      ),
    },
    {
      key: 'overrides',
      title: dict.ranking.overrides.listTitle,
      description: dict.ranking.overrides.listHint,
      rows: (
        <OverridesRows
          copy={dict.ranking}
          shards={shards}
          shard={shard}
          overrides={overrides}
          orphans={orphans}
          options={options}
          canOverride={canOverride}
        />
      ),
    },
    {
      key: 'hides',
      title: dict.ranking.hides.title,
      description: dict.ranking.hides.hint,
      rows: <RankingHidesList copy={dict.ranking} hides={hides} />,
    },
  ];

  return (
    <BoardPage
      // The module shell above renders the title, the description and the trail.
      ownsHeader={false}
      title={dict.navigation.ranking.users.label}
      description={dict.navigation.ranking.users.description}
      sections={sections}
    />
  );
}
