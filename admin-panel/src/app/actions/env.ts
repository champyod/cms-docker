'use server';

import fs from 'fs/promises';
import path from 'path';
import { ensurePermission } from '@/lib/permissions';
import { getRepoRoot } from '@/lib/repo-root';
import { recordAudit } from '@/lib/audit';
import { validateNotificationEnvUpdates } from '@/lib/discord-webhook';
import { CONTEST_ID_KEY, setContestId } from '@/lib/active-contest';
import { CONFIG_TOML_FILE } from '@/lib/config-toml';

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
