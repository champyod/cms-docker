'use server';

import fs from 'fs/promises';
import path from 'path';
import { ensurePermission } from '@/lib/permissions';
import { getRepoRoot } from '@/lib/repo-root';
import { recordAudit } from '@/lib/audit';
import { readTomlValue, upsertTomlValue } from '@/lib/discord-webhook';
import {
  CONTEST_ID_KEY,
  readActiveContestId as readActiveContestIdFromDb,
} from '@/lib/active-contest';
import {
  CONFIG_TOML_FILE,
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
 *
 * One key group is addressed through its own section rather than the one the screen asks for: the
 * POSTGRES_* settings live in a [db_<name>] profile now, so they are resolved before every read and
 * write (see resolveConfigSection).
 */

/** The [core] key naming the profile `./cms config sync` projects into [core], and hence into .env. */
const ACTIVE_DATABASE_KEY = 'ACTIVE_DATABASE';

/** The profile name the sync falls back to when [core] ACTIVE_DATABASE is absent. */
const DEFAULT_DB_PROFILE = 'default';

/** Key prefix config.toml keeps in a [db_<name>] profile instead of in [core]. */
const DB_PROFILE_KEY_PREFIX = 'POSTGRES_';

/** True when the config text declares a [<section>] header, wherever its keys are. */
function tomlSectionExists(content: string, section: string): boolean {
  const header = `[${section}]`;
  return content.split('\n').some((line) => line.trim() === header);
}

/**
 * The section a setting is really stored in.
 *
 * config.toml moved every POSTGRES_* key out of [core] into a [db_<name>] profile, and
 * `./cms config sync` projects only the profile [core] ACTIVE_DATABASE names back into [core] when
 * it regenerates .env. A settings screen that still addressed them as [core] therefore read nothing,
 * and a write there was relocated into [db_default] by the next sync — an apply that silently left
 * the running database untouched. Resolving to the active profile is what makes the read and the
 * write land on the database the deployment reads from. A config.toml that predates the move has no
 * such section, keeps the key in [core], and is migrated by the sync.
 */
function resolveConfigSection(content: string, { section, key }: ConfigTomlKey): string {
  if (section !== 'core' || !key.startsWith(DB_PROFILE_KEY_PREFIX)) return section;
  const profile = readTomlValue(content, 'core', ACTIVE_DATABASE_KEY) || DEFAULT_DB_PROFILE;
  const profileSection = `db_${profile}`;
  return tomlSectionExists(content, profileSection) ? profileSection : section;
}

/** Every requested key read from the section it really lives in; see resolveConfigSection. */
function readResolvedValues(content: string, keys: readonly ConfigTomlKey[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const entry of keys) {
    values[entry.key] = readTomlValue(content, resolveConfigSection(content, entry), entry.key);
  }
  return values;
}

/** Applies every update inside the section it really lives in; see resolveConfigSection. */
function applyResolvedUpdates(content: string, updates: readonly ConfigTomlUpdate[]): string {
  return updates.reduce((accumulated, update) => {
    const section = resolveConfigSection(accumulated, update);
    return upsertTomlValue(accumulated, section, update.key, singleLineValue(update.value));
  }, content);
}

/** A TOML basic string cannot span lines, and the sync reads one line per key. */
function singleLineValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ');
}

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
    const values = readResolvedValues(content, keys);
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
    await fs.writeFile(tomlPath, applyResolvedUpdates(content, updates));
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

// The [db_<name>] sections config.toml declares, in file order. The captured name is the value
// [core] ACTIVE_DATABASE selects and what `./cms config sync` resolves POSTGRES_* from.
const DB_PROFILE_RE = /^\[db_([A-Za-z0-9_-]+)\]\s*$/gm;

function extractDatabaseProfileNames(content: string): string[] {
  return [...content.matchAll(DB_PROFILE_RE)].map(match => match[1]);
}

/**
 * The profiles an operator can switch the active database to. The selector is fed from the file
 * itself, so every option names a section config sync can resolve and a typo cannot point the
 * generated .env at a profile that does not exist.
 */
export async function readDatabaseProfiles(): Promise<
  { success: true; profiles: string[] } | { success: false; error: string }
> {
  await ensurePermission('env:read');
  await ensurePermission('env:list');
  try {
    const content = await fs.readFile(path.join(getRepoRoot(), CONFIG_TOML_FILE), 'utf-8');
    const profiles = extractDatabaseProfileNames(content);
    await recordAudit({
      verb: 'config:view',
      entity: 'config',
      // Section names only: they name the profiles without exposing the credentials each one holds.
      afterValues: { file: CONFIG_TOML_FILE, requestedKeys: profiles.map(name => `db_${name}`) },
      result: 'success',
    });
    return { success: true, profiles };
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
