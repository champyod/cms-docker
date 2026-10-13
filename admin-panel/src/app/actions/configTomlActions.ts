'use server';

import fs from 'fs/promises';
import path from 'path';
import { ensurePermission } from '@/lib/permissions';
import { getRepoRoot } from '@/lib/repo-root';
import { recordAudit } from '@/lib/audit';
import {
  CONTEST_ID_KEY,
  readActiveContestId as readActiveContestIdFromDb,
  writeActiveContestId as writeActiveContestIdToDb,
} from '@/lib/active-contest';
import {
  CONFIG_TOML_FILE,
  applyConfigTomlUpdates,
  extractConfigTomlValues,
  isConfigTomlSection,
  isValidConfigKey,
  type ConfigTomlKey,
  type ConfigTomlUpdate,
} from '@/lib/config-toml';

/**
 * The config.toml actions, kept apart from the .env ones in `env.ts` because they are a different
 * file with a different lifecycle: config.toml is the source `./cms config sync` regenerates .env
 * from, which is also why their audit rows carry the `config` entity where the .env rows carry
 * `env`. The permission keys stay `env:*` — they gate one settings surface, not one file.
 */

export async function readConfigTomlValues(
  keys: readonly ConfigTomlKey[],
): Promise<{ success: true; values: Record<string, string> } | { success: false; error: string }> {
  await ensurePermission('env:read');
  await ensurePermission('env:list');
  const invalid = describeInvalidKeys(keys);
  if (invalid !== null) {
    return { success: false, error: invalid };
  }
  try {
    const content = await fs.readFile(path.join(getRepoRoot(), CONFIG_TOML_FILE), 'utf-8');
    const values = extractConfigTomlValues(content, keys);
    await recordAudit({
      verb: 'config:view',
      entity: 'config',
      // Keys only, as on env:update: the read sections hold credentials (POSTGRES_PASSWORD,
      // RANKING_PASSWORD), so the row names the sections asked for and never their values.
      afterValues: { file: CONFIG_TOML_FILE, requestedKeys: keys.map(({ section, key }) => `${section}.${key}`) },
      result: 'success',
    });
    return { success: true, values };
  } catch (error) {
    await recordAudit({
      verb: 'config:view',
      entity: 'config',
      afterValues: { file: CONFIG_TOML_FILE, error: error instanceof Error ? error.name : 'UnknownError' },
      result: 'failure',
    });
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Writes panel edits into config.toml, the file `./cms config sync` regenerates .env from.
 * Deliberately does not mirror the values into .env: a second writable copy of a generated
 * file is the drift this path exists to remove, and every restart runs the sync first.
 */
export async function updateConfigTomlValues(
  updates: readonly ConfigTomlUpdate[],
): Promise<{ success: true } | { success: false; error: string }> {
  await ensurePermission('env:update');
  const invalid = describeInvalidKeys(updates);
  if (invalid !== null) {
    return { success: false, error: invalid };
  }
  try {
    const tomlPath = path.join(getRepoRoot(), CONFIG_TOML_FILE);
    const content = await fs.readFile(tomlPath, 'utf-8');
    await fs.writeFile(tomlPath, applyConfigTomlUpdates(content, updates));
    await recordAudit({
      verb: 'env:update',
      entity: 'config',
      // Keys only: the section holds credentials (POSTGRES_PASSWORD, RANKING_PASSWORD).
      afterValues: { file: CONFIG_TOML_FILE, changedKeys: updates.map(({ key }) => key) },
      result: 'success',
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

function describeInvalidKeys(keys: readonly ConfigTomlKey[]): string | null {
  for (const { section, key } of keys) {
    if (!isConfigTomlSection(section)) {
      return `Not a config.toml section: ${section}`;
    }
    if (!isValidConfigKey(key)) {
      return `Not a valid config key: ${key}`;
    }
  }
  return null;
}

export async function readActiveContestId(): Promise<{ success: true; contestId: number | null } | { success: false; error: string }> {
  await ensurePermission('env:read');
  await ensurePermission('env:list');
  try {
    // config.toml and .env are generated from the database, so reading either here would
    // show a value a sync is free to change. The database authors the active contest.
    const contestId = await readActiveContestIdFromDb();
    await recordAudit({
      verb: 'config:view',
      entity: 'config',
      // The id, matching what a write records, is what a page load that lands here looked
      // up: it names the active contest without exposing the rest of the table.
      afterValues: { source: 'contests.is_active', [CONTEST_ID_KEY]: contestId },
      result: 'success',
    });
    return { success: true, contestId };
  } catch (error) {
    await recordAudit({
      verb: 'config:view',
      entity: 'config',
      afterValues: { source: 'contests.is_active', error: error instanceof Error ? error.name : 'UnknownError' },
      result: 'failure',
    });
    return { success: false, error: (error as Error).message };
  }
}

export async function writeActiveContestId(id: number): Promise<{ success: true } | { success: false; error: string }> {
  await ensurePermission('env:update');
  try {
    // Persist to the database only, the single source of truth. Reaching the running stack
    // is the deploy path's job (config sync regenerates config.toml/.env from this row,
    // then the contest services are recreated), so a sync can no longer erase it the way a
    // write to a generated file would be.
    await writeActiveContestIdToDb(id);
    await recordAudit({
      verb: 'env:update',
      entity: 'config',
      afterValues: { source: 'contests.is_active', [CONTEST_ID_KEY]: id },
      result: 'success',
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}
