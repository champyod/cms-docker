'use server';

import fs from 'fs/promises';
import path from 'path';
import { ensurePermission } from '@/lib/permissions';

const getRepoRoot = () => process.env.IS_DOCKER === 'true' ? '/repo-root' : path.resolve(process.cwd(), '..');

export async function readEnvFile(filename: string) {
  await ensurePermission('all');
  try {
    const repoRoot = getRepoRoot();
    const envPath = path.join(repoRoot, filename);
    const content = await fs.readFile(envPath, 'utf-8');
    
    // Parse into key-value pairs
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
  await ensurePermission('all');
  try {
    const repoRoot = getRepoRoot();
    const envPath = path.join(repoRoot, filename);
    let content = await fs.readFile(envPath, 'utf-8');
    
    // Update or append
    Object.entries(updates).forEach(([key, value]) => {
      const regex = new RegExp(`^${key}=.*`, 'm');
      if (regex.test(content)) {
        content = content.replace(regex, `${key}=${value}`);
      } else {
        content += `\n${key}=${value}`;
      }
    });

    await fs.writeFile(envPath, content);
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function readActiveContestId(): Promise<{ success: true; contestId: number | null } | { success: false; error: string }> {
  await ensurePermission('all');
  try {
    const repoRoot = getRepoRoot();
    const envPath = path.join(repoRoot, '.env.contest');
    const content = await fs.readFile(envPath, 'utf-8');
    
    // Try ACTIVE_CONTEST_ID first, then CONTEST_ID for backward compat
    const matchActive = content.match(/^ACTIVE_CONTEST_ID=(\d+)/m);
    const matchContest = content.match(/^CONTEST_ID=(\d+)/m);
    const match = matchActive || matchContest;
    
    if (match) {
      return { success: true, contestId: parseInt(match[1], 10) };
    }
    return { success: true, contestId: null };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function writeActiveContestId(id: number): Promise<{ success: true } | { success: false; error: string }> {
  await ensurePermission('all');
  try {
    const repoRoot = getRepoRoot();
    const envPath = path.join(repoRoot, '.env.contest');
    let content = await fs.readFile(envPath, 'utf-8');
    
    if (content.match(/^ACTIVE_CONTEST_ID=/m)) {
      content = content.replace(/^ACTIVE_CONTEST_ID=.*/m, `ACTIVE_CONTEST_ID=${id}`);
    } else {
      content += `\nACTIVE_CONTEST_ID=${id}`;
    }
    
    // Also update CONTEST_ID for docker-compose compatibility
    if (content.match(/^CONTEST_ID=/m)) {
      content = content.replace(/^CONTEST_ID=.*/m, `CONTEST_ID=${id}`);
    } else {
      content += `\nCONTEST_ID=${id}`;
    }
    
    await fs.writeFile(envPath, content);
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function migrateFromMultiContest(): Promise<{ success: true; contestId: number | null; migrated: boolean } | { success: false; error: string }> {
  await ensurePermission('all');
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
          content += `\n# Migrated from multi-contest format\nACTIVE_CONTEST_ID=${firstContestId}\nCONTEST_ID=${firstContestId}\n`;
          await fs.writeFile(envPath, content);
          console.log(`Migrated from multi-contest format. Active contest set to ID ${firstContestId}`);
          return { success: true, contestId: firstContestId, migrated: true };
        }
      }
    } catch (parseError) {
      console.error('Failed to parse CONTESTS_DEPLOY_CONFIG:', parseError);
    }
    
    return { success: true, contestId: null, migrated: false };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}
