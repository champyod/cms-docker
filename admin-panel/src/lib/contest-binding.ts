import path from 'path';

import { prisma } from '@/lib/prisma';
import { readActiveContestId } from '@/lib/active-contest';
import { readConfigFile } from '@/lib/config-file';
import { CONFIG_TOML_FILE } from '@/lib/config-toml';
import { readTomlValue } from '@/lib/discord-webhook';
import { getRepoRoot } from '@/lib/repo-root';
import { CONTEST_WEB_SERVER_ROLE, type ShardContestBinding } from '@/lib/service-wiring-contract';

/** The [contest] key the declared contest web server takes its shard from. */
export const CONTEST_WEB_SERVER_SHARD_KEY = 'CONTEST_WEB_SERVER_SHARD';

/** What a deployment that never set the key runs, matching compose's own `${…:-0}`. */
const DEFAULT_CONTEST_WEB_SERVER_SHARD = 0;

/** How the registry row was reached, when the registry answered at all. */
export type BindingMatch = 'declared-shard' | 'consensus';

/**
 * What the registry answers about the contest one contest web server serves.
 *
 * WHY a source and not just an id: a null id means two different deployments. A row that
 * names no contest makes that server serve *every* contest (the multicontest mode), while
 * the absence of a row leaves the deployment default in charge — the same fallback a stack
 * with an empty registry has. Reporting both as "null" would hide which one is running.
 */
export interface ContestBinding {
  readonly source: 'registry' | 'deployment';
  /** The bound contest, or null when the registry names this instance as serving all of them. */
  readonly contestId: number | null;
  /**
   * Which registry row answered, or null when the deployment default did: `declared-shard` is the
   * row of the shard config.toml declares, `consensus` the one answer the enabled rows agree on
   * because that shard names no row of its own.
   */
  readonly matchedBy: BindingMatch | null;
}

/**
 * The shard the declared contest web server holds.
 *
 * WHY config.toml and not the container: docker-compose.yml starts the declared server with
 * `[contest] CONTEST_WEB_SERVER_SHARD`, so the file is the source and the container's own
 * environment is a copy of it. A server the registry created is not described here — it takes the
 * shard its own row names (scripts/__config_sync.sh renders SERVICE_SHARD per row), which is why
 * resolveContestBinding reads the registry's own rows as well.
 *
 * WHY a file that is missing, and a value that is not a shard, both keep the default: a deployment
 * that never wrote the key runs the shard compose itself defaults to (`${…:-0}`), and neither case
 * is an error worth blanking the page for. WHY an unreadable file is reported instead of folded into
 * that default: a file that exists and refuses to be read is a configuration fault, and rendering it
 * as a shard would present it as the shard this deployment runs (see config-file).
 */
export async function readContestWebServerShard(): Promise<number> {
  const read = await readConfigFile(path.join(getRepoRoot(), CONFIG_TOML_FILE));
  if (read.kind === 'absent') return DEFAULT_CONTEST_WEB_SERVER_SHARD;
  if (read.kind === 'unreadable') throw new Error(read.reason);
  const raw = readTomlValue(read.content, 'contest', CONTEST_WEB_SERVER_SHARD_KEY).trim();
  const shard = Number(raw);
  return raw !== '' && Number.isInteger(shard) && shard >= 0 ? shard : DEFAULT_CONTEST_WEB_SERVER_SHARD;
}

interface ContestWebServerRow {
  readonly shard: number;
  readonly contest_id: number | null;
}

/** The registry row that answered for this deployment, and which of the two answers it was. */
interface BoundRowSelection {
  readonly row: ContestWebServerRow;
  readonly matchedBy: BindingMatch;
}

/**
 * The registry row the deployment's own contest web server resolves against, or null when the
 * registry names no row for it, with how the row was reached.
 *
 * WHY the declared shard first: the declared server runs the shard config.toml hands it, so that
 * shard — not the registry's lowest id — picks its row, which is also the row cms.db.contest_binding
 * reads for it (role, shard, enabled; lowest id). WHY the rows themselves second: a server the
 * registry created takes the shard its own row names, so a declared shard that names no row still
 * leaves one answer whenever the enabled servers all name the same contest. Servers that disagree
 * name no single contest, and the deployment default answers instead of one of them.
 *
 * WHY the answer says which of the two it was: a declared shard that names no row means config.toml
 * and the registry disagree about the shard, which is the mismatch this fallback would otherwise
 * hide. The binding carries it and the panel's bound-contest read records it, so the case is
 * observable without a warning of its own.
 */
function selectBoundRow(
  rows: readonly ContestWebServerRow[],
  declaredShard: number,
): BoundRowSelection | null {
  const declared = rows.find((row) => row.shard === declaredShard);
  if (declared !== undefined) return { row: declared, matchedBy: 'declared-shard' };
  const [first, ...rest] = rows;
  if (first === undefined) return null;
  return rest.every((row) => row.contest_id === first.contest_id)
    ? { row: first, matchedBy: 'consensus' }
    : null;
}

/**
 * The contest a contest web server of this deployment serves, resolved the way the server
 * resolves it for itself (cms.db.contest_binding: the registry row that names this instance,
 * else the deployment default).
 *
 * WHY every enabled row and not just the declared shard's: the registry authors one row per
 * instance and each server reads the row of the shard its own container runs, so a lookup that
 * only knew the configured shard could miss the row of a registry-created server, or read the
 * wrong one. See selectBoundRow for the order the answers are read in.
 */
export async function resolveContestBinding(declaredShard: number): Promise<ContestBinding> {
  const rows = await prisma.services.findMany({
    where: { role: CONTEST_WEB_SERVER_ROLE, enabled: true },
    orderBy: { id: 'asc' },
    select: { shard: true, contest_id: true },
  });
  const selection = selectBoundRow(rows, declaredShard);
  if (selection === null) {
    return { source: 'deployment', contestId: await readActiveContestId(), matchedBy: null };
  }
  return { source: 'registry', contestId: selection.row.contest_id, matchedBy: selection.matchedBy };
}

/**
 * Every enabled registry row that names a contest, lowest shard first — the per-shard truth the
 * panel shows in place of one active-contest id.
 *
 * WHY the rows and not contests.is_active: the flag is a single value, so it cannot say that shard 0
 * serves contest 9 while shard 1 serves contest 7; a services row names the contest its own instance
 * serves, and cms.db.contest_binding reads that row per call, so the registry — not the flag —
 * decides what is served. WHY a row that names no contest is left out: it binds no per-shard contest
 * (it serves every one), so it states nothing to show against a shard. WHY a disabled row is left
 * out: its container is not running, so listing it would claim a binding nothing serves.
 */
export async function readShardContestBindings(): Promise<ShardContestBinding[]> {
  const rows = await prisma.services.findMany({
    where: { enabled: true, contest_id: { not: null } },
    orderBy: [{ shard: 'asc' }, { role: 'asc' }, { id: 'asc' }],
    select: { id: true, name: true, role: true, shard: true, contest_id: true },
  });
  return rows.flatMap((row) => (row.contest_id === null ? [] : [{
    id: row.id,
    name: row.name,
    role: row.role,
    shard: row.shard,
    contestId: row.contest_id,
  }]));
}
