import { Tabs } from '@/components/core/Tabs';
import type { Dictionary } from '@/lib/dictionary';
import type { RankingShard } from '@/lib/ranking-shards';

export interface RankingShardTabsProps {
  readonly shards: readonly RankingShard[];
  readonly activeShard: number;
  readonly copy: Dictionary['ranking']['overrides'];
}

/** Hidden at one shard: a single tab offers no switch the page does not already show. */
export function RankingShardTabs({ shards, activeShard, copy }: RankingShardTabsProps): React.JSX.Element | null {
  if (shards.length < 2) return null;
  return (
    <Tabs
      items={shards.map((shard) => ({
        id: String(shard.shard),
        label: `${copy.shardLabel} ${shard.shard}, ${shard.contestName}`,
        href: `?shard=${shard.shard}`,
      }))}
      activeId={String(activeShard)}
      ariaLabel={copy.shardTabs}
    />
  );
}
