'use server';

import fs from 'fs/promises';
import path from 'path';
import { ensurePermission } from '@/lib/permissions';
import { getRepoRoot } from '@/lib/repo-root';
import { recordAudit } from '@/lib/audit';
import { validateNotificationEnvUpdates } from '@/lib/discord-webhook';
import { CONTEST_ID_KEY, readContestId, setContestId } from '@/lib/active-contest';
import {
  CONFIG_TOML_FILE,
  applyConfigTomlUpdates,
  extractConfigTomlValues,
  isConfigTomlSection,
  isValidConfigKey,
  type ConfigTomlKey,
  type ConfigTomlUpdate,
} from '@/lib/config-toml';

const ALLOWED_ENV_FILES = new Set(['.env']);

function resolveEnvPath(repoRoot: string, filename: string): string {
  if (!ALLOWED_ENV_FILES.has(filename)) {
    throw new Error(`File not allowed: ${filename}`);
  }
  return path.join(repoRoot, filename);
}

/** Reads a file, returning null when it does not exist; any other failure is rethrown. */
async function readFileIfPresent(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') {
      throw error;
    }
    return null;
  }
}

/** Reads and parses the env file. Throws on any failure, so each caller decides how to report it. */
async function loadEnvFile(filename: string): Promise<{ content: string; config: Record<string, string> }> {
  const repoRoot = getRepoRoot();
  const envPath = resolveEnvPath(repoRoot, filename);
  const content = await fs.readFile(envPath, 'utf-8');

  const lines = content.split('\n');
  const config: Record<string, string> = {};

  lines.forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const [key, ...values] = trimmed.split('=');
      config[key.trim()] = values.join('=').trim();
    }
  });

  return { content, config };
}

/**
 * The parsed env file, unaudited, for a caller that reads it to act rather than to show it: the
 * test-alert path resolves the webhook from it and then records its own action. A row here would
 * name a read the operator never asked for, next to the row for the action they did.
 */
export async function readEnvFileCore(filename: string) {
  await ensurePermission('env:read');
  await ensurePermission('env:list');
  try {
    return { success: true as const, ...(await loadEnvFile(filename)) };
  } catch (error) {
    return { success: false as const, error: (error as Error).message };
  }
}

export async function readEnvFile(filename: string) {
  await ensurePermission('env:read');
  await ensurePermission('env:list');
  try {
    const { content, config } = await loadEnvFile(filename);
    await recordAudit({
      verb: 'env:view',
      entity: 'env',
      // Why keys only: this read hands back every value in the file, secrets included, so the
      // audit row records which keys were exposed and never what they hold.
      afterValues: { filename, requestedKeys: Object.keys(config) },
      result: 'success',
    });
    return { success: true as const, content, config };
  } catch (error) {
    await recordAudit({
      verb: 'env:view',
      entity: 'env',
      afterValues: { filename, error: error instanceof Error ? error.name : 'UnknownError' },
      result: 'failure',
    });
    return { success: false as const, error: (error as Error).message };
  }
}

export async function updateEnvFile(filename: string, updates: Record<string, string>) {
  await ensurePermission('env:update');
  const checked = validateNotificationEnvUpdates(updates);
  if (!checked.ok) {
    return { success: false, error: checked.error };
  }
  const validatedUpdates = checked.updates;
  try {
    const repoRoot = getRepoRoot();
    const envPath = resolveEnvPath(repoRoot, filename);
    let content = await fs.readFile(envPath, 'utf-8');
    
    Object.entries(validatedUpdates).forEach(([key, value]) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        return;
      }
      const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const sanitizedValue = value.replace(/[\r\n]+/g, ' ');
      const regex = new RegExp(`^${escapedKey}=.*`, 'm');
      if (regex.test(content)) {
        content = content.replace(regex, `${key}=${sanitizedValue}`);
      } else {
        content += `\n${key}=${sanitizedValue}`;
      }
    });

    await fs.writeFile(envPath, content);
    await recordAudit({
      verb: 'env:update',
      entity: 'env',
      afterValues: { filename, changedKeys: Object.keys(validatedUpdates).filter((k) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) },
      result: 'success',
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
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
    // config.toml is the source of truth; reading the generated env file here made the
    // display lag the value the panel just wrote and drift from a config sync.
    const content = await fs.readFile(path.join(getRepoRoot(), CONFIG_TOML_FILE), 'utf-8');
    const contestId = readContestId(content);
    await recordAudit({
      verb: 'config:view',
      entity: 'config',
      // The id, matching what writeActiveContestId records, is what a page load that lands here
      // looked up: it names the active contest without exposing the rest of the file.
      afterValues: { file: CONFIG_TOML_FILE, [CONTEST_ID_KEY]: contestId },
      result: 'success',
    });
    return { success: true, contestId };
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

export async function writeActiveContestId(id: number): Promise<{ success: true } | { success: false; error: string }> {
  await ensurePermission('env:update');
  try {
    const tomlPath = path.join(getRepoRoot(), CONFIG_TOML_FILE);
    const content = await fs.readFile(tomlPath, 'utf-8');
    // Persist to the source only. Reaching the running stack is the deploy path's job
    // (config sync regenerates .env, then the contest services are recreated), so a sync
    // can no longer erase this the way a write to the generated .env would be.
    await fs.writeFile(tomlPath, setContestId(content, id));
    await recordAudit({
      verb: 'env:update',
      entity: 'config',
      afterValues: { file: CONFIG_TOML_FILE, [CONTEST_ID_KEY]: id },
      result: 'success',
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function migrateFromMultiContest(): Promise<{ success: true; contestId: number | null; migrated: boolean } | { success: false; error: string }> {
  await ensurePermission('env:update');
  try {
    const repoRoot = getRepoRoot();
    // The generated env file is where a legacy multi-contest deployment kept this key.
    const envPath = path.join(repoRoot, '.env');
    const envContent = await readFileIfPresent(envPath);
    // No generated env file yet — nothing legacy to migrate, and not a failure.
    if (envContent === null) {
      return { success: true, contestId: null, migrated: false };
    }
    let content = envContent;

    const deployConfigMatch = content.match(/^CONTESTS_DEPLOY_CONFIG=(.*)/m);
    if (!deployConfigMatch) {
      return { success: true, contestId: null, migrated: false };
    }

    try {
      const deployConfig = JSON.parse(deployConfigMatch[1]);
      if (Array.isArray(deployConfig) && deployConfig.length > 0) {
        const firstContestId = deployConfig[0].id;
        if (typeof firstContestId === 'number') {
          content = content.replace(/^CONTESTS_DEPLOY_CONFIG=.*\n?/m, '');
          await fs.writeFile(envPath, content);
          // The migrated id belongs in config.toml, not in the generated .env.
          const tomlPath = path.join(repoRoot, CONFIG_TOML_FILE);
          const tomlContent = await fs.readFile(tomlPath, 'utf-8');
          await fs.writeFile(tomlPath, setContestId(tomlContent, firstContestId));
          await recordAudit({
            verb: 'env:update',
            entity: 'config',
            afterValues: { file: CONFIG_TOML_FILE, [CONTEST_ID_KEY]: firstContestId, removedFrom: 'CONTESTS_DEPLOY_CONFIG' },
            beforeValues: { migratedFrom: 'CONTESTS_DEPLOY_CONFIG' },
            result: 'success',
          });
          return { success: true, contestId: firstContestId, migrated: true };
        }
      }
    } catch {
      }

    return { success: true, contestId: null, migrated: false };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}
