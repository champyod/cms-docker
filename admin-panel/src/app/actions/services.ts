'use server';

import fs from 'fs/promises';
import path from 'path';
import { revalidatePath } from 'next/cache';
import { exec } from 'child_process';
import util from 'util';
import { ensurePermission } from '@/lib/permissions';

const execPromise = util.promisify(exec);

const getRepoRoot = () => process.env.IS_DOCKER === 'true' ? '/repo-root' : path.resolve(process.cwd(), '..');

export async function switchContest(contestId: number) {
  await ensurePermission('contests');
  try {
    // Verify path existence
    const repoRoot = getRepoRoot();
    let envPath = path.join(repoRoot, '.env.contest');
    try {
      await fs.access(envPath);
    } catch {
      // Fallback: try current directory or other typical locations
      const altPath = path.resolve(process.cwd(), '.env.contest');
      try {
        await fs.access(altPath);
        envPath = altPath;
      } catch {
        // Try one level up if in .next/server or similar
        const upUpPath = path.resolve(process.cwd(), '../../.env.contest');
        try {
          await fs.access(upUpPath);
          envPath = upUpPath;
        } catch {
          console.error('Could not find .env.contest in', process.cwd(), 'or parents');
          // Keep default and let readFile fail with precise error
        }
      }
    }

    let content = '';
    try {
      content = await fs.readFile(envPath, 'utf-8');
    } catch (e) {
      console.error(`Failed to read .env.contest at ${envPath}`, e);
      return { success: false, error: 'Could not read configuration file at ' + envPath };
    }

    const newContent = content.replace(/^CONTEST_ID=\d+/m, `CONTEST_ID=${contestId}`);

    if (content === newContent && !content.includes('CONTEST_ID=')) {
        await fs.writeFile(envPath, content + `\nCONTEST_ID=${contestId}\n`);
    } else {
        await fs.writeFile(envPath, newContent);
    }

    const rootDir = path.resolve(process.cwd(), '..');
    const cmd = `docker compose -f docker-compose.contest.yml up -d --build`;
    
    console.log(`Executing: ${cmd} in ${rootDir}`);
    const { stdout, stderr } = await execPromise(cmd, { cwd: rootDir });
    console.log('Docker output:', stdout);
    if (stderr) console.error('Docker stderr:', stderr);

    revalidatePath('/[locale]/contests');
    return { success: true, message: 'Contest switched and services restarting...' };
  } catch (error) {
    const e = error as Error;
    console.error('Switch contest error:', e);
    return { success: false, error: e.message };
  }
}

interface RestartPolicies {
    dependencies: Record<string, string[]>;
    env_triggers: Record<string, string[]>;
}

async function getRestartPolicies(): Promise<RestartPolicies | null> {
    const rootDir = getRepoRoot();
    const policyPath = path.join(rootDir, 'config', 'restart_policies.json');
    try {
        const content = await fs.readFile(policyPath, 'utf-8');
        return JSON.parse(content);
    } catch (e) {
        console.error('Failed to read restart policies:', e);
        return null;
    }
}

export async function analyzeRestartRequirements(changedKeys: string[]) {
    const policies = await getRestartPolicies();
    if (!policies) return { requiredRestarts: [] };

    const initialSet = new Set<string>();
    
    // 1. Identify direct impacts from env vars
    for (const key of changedKeys) {
        // Special case: Multi-contest deployment config
        if (key === 'CONTESTS_DEPLOY_CONFIG') {
            initialSet.add('contest-stack');
            continue;
        }

        const affected = policies.env_triggers[key];
        if (affected) {
            affected.forEach(s => initialSet.add(s));
        }
    }

    // 2. Expand dependencies (transitive closure)
    const finalSet = new Set(initialSet);
    const queue = Array.from(initialSet);
    
    while (queue.length > 0) {
        const current = queue.shift()!;
        const dependents = policies.dependencies[current];
        if (dependents) {
            for (const dep of dependents) {
                if (!finalSet.has(dep)) {
                    finalSet.add(dep);
                    queue.push(dep);
                }
            }
        }
    }

    return { requiredRestarts: Array.from(finalSet) };
}

export async function restartServices(type: 'all' | 'core' | 'worker' | 'custom', customList?: string[]) {
  await ensurePermission('all');
  try {
    const rootDir = getRepoRoot();
    let cmd = '';

    // First, always regenerate the env if customList contains anything that might affect it
    // Or just always do it for safety before any restart
    await execPromise('make env', { cwd: rootDir });

    if (type === 'core') {
      cmd = 'docker compose -f docker-compose.core.yml up -d --build --force-recreate';
    } else if (type === 'worker') {
      cmd = 'docker compose -f docker-compose.worker.yml up -d --build --force-recreate';
    } else if (type === 'custom' && customList && customList.length > 0) {
        // Check if we need to restart the whole contest stack
        const needsContestStack = customList.includes('contest-stack') || customList.some(s => s.startsWith('cms-contest-web-server'));
        
        const files = [
            'docker-compose.core.yml',
            'docker-compose.admin.yml',
            'docker-compose.worker.yml',
            'docker-compose.contests.generated.yml',
            'docker-compose.monitor.yml'
        ].map(f => `-f ${f}`).join(' ');
        
        const filteredList = customList.filter(s => s !== 'contest-stack' && /^[a-zA-Z0-9_-]+$/.test(s));
        
        if (needsContestStack) {
            // Restart all generated contest services
            // Simplest way is to run 'up -d' on the generated file specifically
            cmd = `docker compose ${files} up -d --remove-orphans --force-recreate ${filteredList.join(' ')}`;
        } else {
            if (filteredList.length === 0) return { success: true, message: 'Nothing to restart.' };
            cmd = `docker compose ${files} up -d --force-recreate ${filteredList.join(' ')}`;
        }
    } else {
      // All basic services
      cmd = 'docker compose -f docker-compose.core.yml -f docker-compose.admin.yml -f docker-compose.contests.generated.yml -f docker-compose.worker.yml up -d --build';
    }

    console.log(`Restarting services (${type}): ${cmd}`);
    const { stdout, stderr } = await execPromise(cmd, { cwd: rootDir });
    console.log('Restart output:', stdout);

    return { success: true, message: `Services (${type}) restarted.` };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function getServiceStatus() {
    return { status: 'ok' };
}
