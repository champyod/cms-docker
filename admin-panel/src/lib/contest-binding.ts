import fs from 'fs/promises';
import path from 'path';

import { prisma } from '@/lib/prisma';
import { readActiveContestId } from '@/lib/active-contest';
import { CONFIG_TOML_FILE } from '@/lib/config-toml';
import { readTomlValue } from '@/lib/discord-webhook';
import { getRepoRoot } from '@/lib/repo-root';
import { CONTEST_WEB_SERVER_ROLE } from '@/lib/service-wiring-contract';

/** The [contest] key compose hands the contest web server process as its shard. */
export const CONTEST_WEB_SERVER_SHARD_KEY = 'CONTEST_WEB_SERVER_SHARD';

/** What a deployment that never set the key runs, matching compose's own `${…:-0}`. */
const DEFAULT_CONTEST_WEB_SERVER_SHARD = 0;

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
}

/**
 * The shard the running contest web server holds.
 *
 * WHY config.toml and not the container: `[contest] CONTEST_WEB_SERVER_SHARD` is the value
 * compose projects into the server's own environment when it creates the container, so the
 * file is the source and the container is a copy of it. A missing or unparsable value is
 * the shard compose itself would default to, never an error worth blanking the page for.
 */
export async function readContestWebServerShard(): Promise<number> {
  const content = await fs.readFile(path.join(getRepoRoot(), CONFIG_TOML_FILE), 'utf-8');
  const raw = readTomlValue(content, 'contest', CONTEST_WEB_SERVER_SHARD_KEY).trim();
  const shard = Number(raw);
  return raw !== '' && Number.isInteger(shard) && shard >= 0 ? shard : DEFAULT_CONTEST_WEB_SERVER_SHARD;
}

/**
 * The contest a contest web server on `shard` serves, resolved the way the server resolves
 * it for itself (cms.db.contest_binding: the registry row, else the deployment default).
 *
 * WHY the (role, shard) row and not the first contest web server row: the table authors one
 * row per instance, and each instance serves the contest its own row names — so reading the
 * lowest id of the role handed every deployment's page the first shard's answer.
 */
export async function resolveContestBinding(shard: number): Promise<ContestBinding> {
  const rows = await prisma.services.findMany({
    where: { role: CONTEST_WEB_SERVER_ROLE, shard, enabled: true },
    orderBy: { id: 'asc' },
    select: { contest_id: true },
  });
  const row = rows[0];
  if (row === undefined) return { source: 'deployment', contestId: await readActiveContestId() };
  return { source: 'registry', contestId: row.contest_id };
}
