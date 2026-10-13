'use server';

import fs from 'fs/promises';
import path from 'path';
import { ensurePermission } from '@/lib/permissions';
import { getRepoRoot } from '@/lib/repo-root';
import { recordAudit } from '@/lib/audit';
import { validateNotificationEnvUpdates } from '@/lib/discord-webhook';

const ALLOWED_ENV_FILES = new Set(['.env']);

function resolveEnvPath(repoRoot: string, filename: string): string {
  if (!ALLOWED_ENV_FILES.has(filename)) {
    throw new Error(`File not allowed: ${filename}`);
  }
  return path.join(repoRoot, filename);
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
