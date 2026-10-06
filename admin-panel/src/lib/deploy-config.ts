import { exec } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import util from 'util';

import { readContestId, setContestId } from '@/lib/active-contest';
import { getRepoRoot } from '@/lib/repo-root';
import type { DeployMeta } from '@/lib/deploy-operation-store';

const execPromise = util.promisify(exec);

const CONFIG_SYNC_COMMAND = 'bash scripts/__config_sync.sh';

const getConfigTomlPath = (): string => path.join(getRepoRoot(), 'config.toml');

/** The configuration file's content, or null when it cannot be read. */
async function readConfigToml(): Promise<string | null> {
  return fs.readFile(getConfigTomlPath(), 'utf-8').catch(() => null);
}

export async function readConfigTomlContestId(): Promise<number | null> {
  const content = await readConfigToml();
  if (content === null) return null;
  return readContestId(content);
}

export async function updateConfigTomlContestId(contestId: number): Promise<void> {
  const content = await fs.readFile(getConfigTomlPath(), 'utf-8');
  await fs.writeFile(getConfigTomlPath(), setContestId(content, contestId));
}

export async function runConfigSync(): Promise<void> {
  await execPromise(CONFIG_SYNC_COMMAND, { cwd: getRepoRoot() });
}

/** Whether `config.toml` still names `contestId`, or null when the file cannot be read at all. */
async function configTomlNamesContest(contestId: number): Promise<boolean | null> {
  const content = await readConfigToml();
  if (content === null) return null;
  return readContestId(content) === contestId;
}

/**
 * Puts the active contest back to what this operation replaced, changing only the key this operation
 * owns and re-reading the file as close to the write as the design allows.
 *
 * Why the content written is read here rather than taken from the ownership check that preceded it:
 * anything another writer puts in config.toml in between — a webhook or a credential key from
 * `env:update`, which the deploy guard does not gate because only a deploy takes it — would be
 * reverted together with that snapshot, silently and undetectably. What remains is the window between
 * this read and the write below, which the filesystem gives us no way to make one operation: it is one
 * `await` wide, and closing it would take a lock file the whole project would have to honour.
 *
 * Why the ownership condition is repeated on this fresh read: the write is only correct while this
 * operation is the file's last writer. A config.toml that already names another contest belongs to a
 * newer deploy, and reverting it would leave the file and the database asserting different contests —
 * the split this path exists to avoid. Repeating it here is also what keeps the check and the write
 * from spanning an edit: the check before this call is about whether to try at all, this one is about
 * what to write.
 */
async function revertOwnedContestId(expected: number, previous: number): Promise<'reverted' | 'not_ours' | 'unreadable'> {
  const content = await readConfigToml();
  if (content === null) return 'unreadable';
  if (readContestId(content) !== expected) return 'not_ours';
  await fs.writeFile(getConfigTomlPath(), setContestId(content, previous));
  return 'reverted';
}

/**
 * Reverts the configuration for a deploy that will not complete, and skips the revert when the file is
 * no longer this operation's to touch.
 *
 * Why the check before the write: a revert is only correct while this operation is the file's last
 * writer, so the file is read once to decide whether this settle should revert at all — and separately
 * again inside `revertOwnedContestId`, which is the content the write is derived from.
 */
export async function rollbackContestId(meta: DeployMeta): Promise<string | null> {
  if (meta.previousContestId === undefined) return null;
  const owned = await configTomlNamesContest(meta.contestId);
  if (owned === null) return 'Could not read CONTEST_ID from config.toml during rollback.';
  if (!owned) return null;
  try {
    const reverted = await revertOwnedContestId(meta.contestId, meta.previousContestId);
    if (reverted === 'unreadable') return 'Could not read CONTEST_ID from config.toml during rollback.';
    // Lost the file to a newer deploy between the two reads: its contest is the one that stands, and
    // the database already agrees with it.
    if (reverted === 'not_ours') return null;
    await runConfigSync();
    return null;
  } catch (error) {
    return `Rollback to contest #${meta.previousContestId} failed: ${(error as Error).message}`;
  }
}
