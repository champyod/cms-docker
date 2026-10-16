import { readActiveContestId } from '@/lib/active-contest';
import { readShardContestBindings } from '@/lib/contest-binding';
import { prisma } from '@/lib/prisma';
import { CONTEST_WEB_SERVER_ROLE, type ShardContestBinding } from '@/lib/service-wiring-contract';

/**
 * One ranking shard: the contest its registry rows bind it to.
 *
 * WHY the shard and not the contest is the tab: the operator reasons about the board a shard
 * serves, and the same contest may be served by more than one role on one shard, so the shard is
 * the unit the registry authors and the one a tab can switch.
 */
export interface RankingShard {
  readonly shard: number;
  readonly contestId: number;
  readonly contestName: string;
}

function groupByShard(bindings: readonly ShardContestBinding[]): Map<number, ShardContestBinding[]> {
  const groups = new Map<number, ShardContestBinding[]>();
  for (const binding of bindings) {
    const rows = groups.get(binding.shard);
    if (rows === undefined) groups.set(binding.shard, [binding]);
    else rows.push(binding);
  }
  return groups;
}

/**
 * The contest one shard serves.
 *
 * WHY the contest web server's own row wins a disagreement: it is the role whose row
 * cms.db.contest_binding reads for the shard, so a proxy row that names another contest is the
 * outlier rather than the answer. A shard with no such row takes its lowest-id row, which is the
 * same first-row rule cms.db.contest_binding resolves a missing row with.
 */
function contestForShard(rows: readonly ShardContestBinding[]): number {
  const declared = rows.find((row) => row.role === CONTEST_WEB_SERVER_ROLE);
  return (declared ?? rows[0]).contestId;
}

async function contestNames(contestIds: readonly number[]): Promise<Map<number, string>> {
  const rows = await prisma.contests.findMany({
    where: { id: { in: [...contestIds] } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((row) => [row.id, row.name]));
}

/**
 * The single shard a deployment with an empty registry serves, so the surface still works.
 *
 * WHY the active contest: cms.db.contest_binding falls back to contests.is_active when no enabled
 * row names the instance, so the deployment's one board is that contest and the surface has one
 * implicit shard rather than none.
 */
async function fallbackShard(): Promise<Map<number, number>> {
  const contestId = await readActiveContestId();
  return contestId === null ? new Map() : new Map([[0, contestId]]);
}

/** The shards the surface may switch between, lowest shard first, each with the contest it serves. */
export async function readRankingShards(): Promise<RankingShard[]> {
  const bindings = await readShardContestBindings();
  const byShard = groupByShard(bindings);
  const chosen =
    byShard.size === 0
      ? await fallbackShard()
      : new Map([...byShard.entries()].map(([shard, rows]) => [shard, contestForShard(rows)]));
  if (chosen.size === 0) return [];
  const names = await contestNames([...chosen.values()]);
  return [...chosen.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([shard, contestId]) => {
      const contestName = names.get(contestId);
      return contestName === undefined ? [] : [{ shard, contestId, contestName }];
    });
}

/**
 * The shard the request asked for, or the first one.
 *
 * WHY the first and not an error: a stale bookmark to a shard the registry no longer authors must
 * land on a real board rather than a blank page, and the first shard is the deterministic one
 * cms.db.contest_binding would have answered with.
 */
export function selectShard(
  shards: readonly RankingShard[],
  raw: string | undefined,
): RankingShard | null {
  if (shards.length === 0) return null;
  const requested = Number(raw);
  return shards.find((shard) => shard.shard === requested) ?? shards[0];
}
