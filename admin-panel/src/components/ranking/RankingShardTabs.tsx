import { Tabs } from '@/components/core/Tabs';
import type { Dictionary } from '@/lib/dictionary';
import type { RankingShard } from '@/lib/ranking-shards';

export interface RankingShardTabsProps {
  readonly shards: readonly RankingShard[];
  readonly activeShard: number;
  readonly copy: Dictionary['ranking']['overrides'];
}

/**
 * The shard strip: one tab per shard, each naming the contest its own rows bind.
 *
 * WHY hidden at one shard: a single-tab strip offers no switch, so it only tells the reader the
 * deployment has one board where the page already shows exactly that. WHY the tab carries the
 * contest name: the operator picks the board by what it serves, not by a shard index.
 */
export function RankingShardTabs({ shards, activeShard, copy }: RankingShardTabsProps): React.JSX.Element | null {
  if (shards.length < 2) return null;
  return (
    <Tabs
      items={shards.map((shard) => ({
        id: String(shard.shard),
        label: `${copy.shardLabel} ${shard.shard} · ${shard.contestName}`,
        href: `?shard=${shard.shard}`,
      }))}
      activeId={String(activeShard)}
      ariaLabel={copy.shardTabs}
    />
  );
}
