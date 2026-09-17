'use server';

import fs from 'fs/promises';
import path from 'path';
import { ensurePermission } from '@/lib/permissions';
import { getRepoRoot } from '@/lib/repo-root';
import { recordAudit } from '@/lib/audit';
import { validateNotificationEnvUpdates } from '@/lib/discord-webhook';
import { CONTEST_ID_KEY, readContestId, setContestId } from '@/lib/active-contest';

const ALLOWED_ENV_FILES = new Set(['.env', '.env.contest']);
const CONFIG_TOML = 'config.toml';

function resolveEnvPath(repoRoot: string, filename: string): string {
  if (!ALLOWED_ENV_FILES.has(filename)) {
    throw new Error(`File not allowed: ${filename}`);
  }
  return path.join(repoRoot, filename);
}

export async function readEnvFile(filename: string) {
  await ensurePermission('env:read');
  try {
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

    return { success: true, content, config };
  } catch (error) {
    return { success: false, error: (error as Error).message };
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

export async function readActiveContestId(): Promise<{ success: true; contestId: number | null } | { success: false; error: string }> {
  await ensurePermission('env:read');
  try {
    // config.toml is the source of truth; reading the generated .env.contest here made the
    // display lag the value the panel just wrote and drift from a config sync.
    const content = await fs.readFile(path.join(getRepoRoot(), CONFIG_TOML), 'utf-8');
    return { success: true, contestId: readContestId(content) };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function writeActiveContestId(id: number): Promise<{ success: true } | { success: false; error: string }> {
  await ensurePermission('env:update');
  try {
    const tomlPath = path.join(getRepoRoot(), CONFIG_TOML);
    const content = await fs.readFile(tomlPath, 'utf-8');
    // Persist to the source only. Reaching the running stack is the deploy path's job
    // (config sync regenerates .env, then the contest services are recreated), so a sync
    // can no longer erase this the way a write to the generated .env would be.
    await fs.writeFile(tomlPath, setContestId(content, id));
    await recordAudit({
      verb: 'env:update',
      entity: 'config',
      afterValues: { file: CONFIG_TOML, [CONTEST_ID_KEY]: id },
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
    const envPath = path.join(repoRoot, '.env.contest');
    let content = await fs.readFile(envPath, 'utf-8');

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
          // The migrated id belongs in config.toml, not in the generated .env.contest.
          const tomlPath = path.join(repoRoot, CONFIG_TOML);
          const tomlContent = await fs.readFile(tomlPath, 'utf-8');
          await fs.writeFile(tomlPath, setContestId(tomlContent, firstContestId));
          await recordAudit({
            verb: 'env:update',
            entity: 'config',
            afterValues: { file: CONFIG_TOML, [CONTEST_ID_KEY]: firstContestId, removedFrom: 'CONTESTS_DEPLOY_CONFIG' },
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
