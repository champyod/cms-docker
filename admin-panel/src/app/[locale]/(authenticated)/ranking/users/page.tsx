import { getRankingOverrideOptions } from '@/app/actions/ranking';
import { getShownTargetChoices, getShownTargets } from '@/app/actions/rankingConfig';
import { getRankingOverrides, type RankingOverride } from '@/app/actions/rankingOverrides';
import { Card } from '@/components/core/Card';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';
import { RankingConfigSurface } from '@/components/ranking/RankingConfigSurface';
import { RankingOverrideList } from '@/components/ranking/RankingOverrideList';
import { RankingOverrideSurface } from '@/components/ranking/RankingOverrideSurface';
import { RankingShardTabs } from '@/components/ranking/RankingShardTabs';
import { getDictionary } from '@/i18n';
import type { Dictionary } from '@/lib/dictionary';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';
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
 * The board's config, mounted ahead of the override surface it precedes.
 *
 * WHY on this page and not a route of its own: the two surfaces answer one question in two
 * halves — what the board shows, then what wins over it — and an operator who can only find one
 * of them reads the other as the same control. The config half is gated on the same write
 * permission, because choosing what the board shows is the same act of control.
 */
async function ShownConfig({
  copy,
  canShow,
}: {
  readonly copy: RankingCopy;
  readonly canShow: boolean;
}): Promise<React.JSX.Element> {
  const [rows, choices] = await Promise.all([getShownTargets(), getShownTargetChoices()]);
  return (
    <RankingConfigSurface copy={copy.shown} rows={rows} choices={choices} canShow={canShow} />
  );
}

interface ShardOverridesProps {
  readonly copy: RankingCopy;
  readonly shards: readonly RankingShard[];
  readonly shard: RankingShard;
  readonly canOverride: boolean;
}

/** The toolbar and its diff pinned on top, the shard's list taking the rest; shape V2. */
async function ShardOverrides({ copy, shards, shard, canOverride }: ShardOverridesProps): Promise<React.JSX.Element> {
  const all = await getRankingOverrides();
  const orphans = await readOrphanContestIds(all);
  const options = canOverride ? await getRankingOverrideOptions() : null;
  return (
    <Card className="space-y-4">
      <Text as="h2" variant="h3">
        {copy.overrides.listTitle}
      </Text>
      <Text variant="muted">{copy.overrides.listHint}</Text>
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
        rows={rowsForShard(all, shard, orphans)}
        orphanContestIds={[...orphans]}
        canOverride={canOverride}
      />
    </Card>
  );
}

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
  const copy = (await getDictionary(locale)).ranking;
  const shards = await readRankingShards();
  const shard = selectShard(shards, readShardParam(query));
  if (shard === null) {
    return (
      <Stack gap={6}>
        <Card>
          <Text variant="muted">{copy.overrides.noShards}</Text>
        </Card>
      </Stack>
    );
  }
  return (
    <Stack gap={6}>
      <ShownConfig copy={copy} canShow={effective.has('ranking:override')} />
      <ShardOverrides
        copy={copy}
        shards={shards}
        shard={shard}
        canOverride={effective.has('ranking:override')}
      />
    </Stack>
  );
}
