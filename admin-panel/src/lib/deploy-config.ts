import { exec } from 'child_process';
import util from 'util';

import { readActiveContestId, writeActiveContestId } from '@/lib/active-contest';
import { getRepoRoot } from '@/lib/repo-root';
import type { DeployMeta } from '@/lib/deploy-operation-store';

const execPromise = util.promisify(exec);

const CONFIG_SYNC_COMMAND = 'bash scripts/__config_sync.sh';

export async function runConfigSync(): Promise<void> {
  await execPromise(CONFIG_SYNC_COMMAND, { cwd: getRepoRoot() });
}

/** Puts the active row back to `previous`; a no-op when the operation replaced nothing. */
export async function revertActiveContest(previous: number | undefined): Promise<void> {
  if (previous === undefined) return;
  try {
    await writeActiveContestId(previous);
  } catch {
    // Best-effort: the caller is already reporting a failure, and a settle with a previous
    // id still recorded retries the revert. Throwing here would replace that error.
  }
}

/**
 * Reverts the active contest for a deploy that will not complete, in the database.
 *
 * Why the database and not config.toml: contests.is_active is the single source of truth,
 * and config.toml/.env are derived from it by the sync — reverting the file would be
 * reverted right back on the next sync. Why the ownership check: the revert is only correct
 * while this operation is the last writer of is_active, so a row already on another contest
 * belongs to a newer deploy and is left alone. A read that fails is reported, not guessed.
 */
export async function rollbackContestId(meta: DeployMeta): Promise<string | null> {
  if (meta.previousContestId === undefined) return null;
  try {
    const current = await readActiveContestId();
    if (current !== meta.contestId) return null;
    await writeActiveContestId(meta.previousContestId);
    await runConfigSync();
    return null;
  } catch (error) {
    return `Rollback to contest #${meta.previousContestId} failed: ${(error as Error).message}`;
  }
}
