'use server';

import fs from 'fs/promises';
import path from 'path';
import { revalidatePath } from 'next/cache';
import { exec } from 'child_process';
import util from 'util';
import { ensurePermission } from '@/lib/permissions';

const execPromise = util.promisify(exec);

const getRepoRoot = () => process.env.IS_DOCKER === 'true' ? '/repo-root' : path.resolve(process.cwd(), '..');

async function logToDiscord(title: string, message: string, color: number = 3447003) {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) return;

    try {
        await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                embeds: [{
                    title,
                    description: message,
                    color,
                    timestamp: new Date().toISOString()
                }]
            })
        });
    } catch (e) {
        console.error('Failed to send discord log:', e);
    }
}

export async function switchContest(contestId: number) {
  await ensurePermission('contests');
  try {
    const repoRoot = getRepoRoot();
    let envPath = path.join(repoRoot, '.env.contest');
    
    let content = await fs.readFile(envPath, 'utf-8');
    const newContent = content.replace(/^CONTEST_ID=\d+/m, `CONTEST_ID=${contestId}`);

    if (content === newContent && !content.includes('CONTEST_ID=')) {
        await fs.writeFile(envPath, content + `\nCONTEST_ID=${contestId}\n`);
    } else {
        await fs.writeFile(envPath, newContent);
    }

    const rootDir = getRepoRoot();
    const cmd = `make env && docker compose -f docker-compose.contest.yml up -d --build`;
    await execPromise(cmd, { cwd: rootDir });

    await logToDiscord('Contest Switch', `Admin switched active contest to ID: **${contestId}**`, 16753920);

    revalidatePath('/[locale]/contests');
    return { success: true, message: 'Contest switched and services restarting...' };
  } catch (error) { return { success: false, error: (error as Error).message }; }
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
    
    for (const key of changedKeys) {
        if (key === 'CONTESTS_DEPLOY_CONFIG') {
            initialSet.add('contest-stack');
            continue;
        }
        const affected = policies.env_triggers[key];
        if (affected) {
            affected.forEach(s => initialSet.add(s));
        }
    }

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

    await execPromise('make env', { cwd: rootDir });

    const files = [
        'docker-compose.core.yml',
        'docker-compose.admin.yml',
        'docker-compose.worker.yml',
        'docker-compose.contests.generated.yml',
        'docker-compose.monitor.yml'
    ].map(f => `-f ${f}`).join(' ');

    if (type === 'core') {
      cmd = 'docker compose -f docker-compose.core.yml up -d --build --force-recreate';
    } else if (type === 'worker') {
      cmd = 'docker compose -f docker-compose.worker.yml up -d --build --force-recreate';
    } else if (type === 'custom' && customList && customList.length > 0) {
        const needsContestStack = customList.includes('contest-stack') || customList.some(s => s.startsWith('cms-contest-web-server'));
        const filteredList = customList.filter(s => s !== 'contest-stack' && /^[a-zA-Z0-9_-]+$/.test(s));
        
        if (needsContestStack) {
            cmd = `docker compose ${files} up -d --remove-orphans --force-recreate ${filteredList.join(' ')}`;
        } else {
            if (filteredList.length === 0) return { success: true, message: 'Nothing to restart.' };
            cmd = `docker compose ${files} up -d --force-recreate ${filteredList.join(' ')}`;
        }
    } else {
      cmd = `docker compose ${files} up -d --build`;
    }

    await logToDiscord('Service Restart', `Admin triggered restart: **${type}** ${customList ? `(${customList.join(', ')})` : ''}`, 16753920);

    const { stdout } = await execPromise(cmd, { cwd: rootDir });
    return { success: true, message: `Services (${type}) restarted.` };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function triggerManualBackup() {
    await ensurePermission('all');
    try {
        const rootDir = getRepoRoot();
        await logToDiscord('Manual Backup', 'Admin triggered a manual submissions backup.', 3447003);
        const cmd = 'docker exec -d cms-monitor bash /usr/local/bin/cms-backup.sh';
        await execPromise(cmd, { cwd: rootDir });
        return { success: true, message: 'Backup process started in background.' };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}

export async function getServiceStatus() {
    return { status: 'ok' };
}