'use server';

import fs from 'fs/promises';
import path from 'path';
import { revalidatePath } from 'next/cache';
import { exec } from 'child_process';
import util from 'util';
import { ensurePermission } from '@/lib/permissions';

const execPromise = util.promisify(exec);

const getRepoRoot = () => process.env.IS_DOCKER === 'true' ? '/repo-root' : path.resolve(process.cwd(), '..');

async function logToDiscord(title: string, message: string, color: number = 3447003, mention: boolean = false) {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) return;

    try {
        const roleId = process.env.DISCORD_ROLE_ID;
        const payload: any = {
            embeds: [{
                title,
                description: message,
                color,
                timestamp: new Date().toISOString()
            }]
        };
        if (mention && roleId) {
            payload.content = `<@&${roleId}>`;
        }
        await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
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

    await logToDiscord('Contest Switch', `Admin switched active contest to ID: **${contestId}**`, 16753920, true);

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

export async function restartServices(type: 'all' | 'core' | 'admin' | 'worker' | 'custom', customList?: string[]) {
  await ensurePermission('all');
  try {
    const rootDir = getRepoRoot();
    let cmd = '';

    // Regenerate env and contest compose
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
    } else if (type === 'admin') {
      cmd = 'docker compose -f docker-compose.admin.yml up -d --build --force-recreate';
    } else if (type === 'worker') {
      cmd = 'docker compose -f docker-compose.worker.yml up -d --build --force-recreate';
    } else if (type === 'custom' && customList && customList.length > 0) {
        const needsContestStack = customList.includes('contest-stack') || customList.some(s => s.startsWith('cms-contest-web-server'));
        const filteredList = customList.filter(s => s !== 'contest-stack' && /^[a-zA-Z0-9_-]+$/.test(s));

        if (needsContestStack) {
            cmd = `docker compose ${files} up -d --remove-orphans --force-recreate`;
        } else {
            if (filteredList.length === 0) return { success: true, message: 'Nothing to restart.' };

            // For per-contest restart, restart related services based on dependencies
            const contestServices: string[] = [];
            const policies = await getRestartPolicies();

            filteredList.forEach(service => {
                if (service.startsWith('cms-contest-web-server-')) {
                    const contestId = service.replace('cms-contest-web-server-', '');
                    // Add contest web server
                    contestServices.push(`cms-contest-web-server-${contestId}`);
                    // Add ranking server for this contest
                    contestServices.push(`cms-ranking-web-server-${contestId}`);

                    // Check dependencies from restart_policies.json
                    if (policies && policies.dependencies['cms-contest-web-server']) {
                        policies.dependencies['cms-contest-web-server'].forEach(dep => {
                            if (!contestServices.includes(dep)) {
                                contestServices.push(dep);
                            }
                        });
                    }
                } else {
                    contestServices.push(service);

                    // Check dependencies for this service
                    if (policies && policies.dependencies[service]) {
                        policies.dependencies[service].forEach(dep => {
                            if (!contestServices.includes(dep)) {
                                contestServices.push(dep);
                            }
                        });
                    }
                }
            });

            cmd = `docker compose ${files} up -d --force-recreate ${contestServices.join(' ')}`;
        }
    } else {
      cmd = `docker compose ${files} up -d --build`;
    }

    await logToDiscord('Service Restart', `Admin triggered restart: **${type}** ${customList ? `(${customList.join(', ')})` : ''}`, 16753920, true);

    const { stdout, stderr } = await execPromise(cmd, { cwd: rootDir, timeout: 120000 });

    // Check if command actually succeeded
    if (stderr && stderr.includes('error')) {
      return { success: false, error: stderr };
    }

    return { success: true, message: `Services (${type}) restarted.`, output: stdout };
  } catch (error) {
    console.error('Restart error:', error);
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
    try {
        const { stdout } = await execPromise('docker ps -a --format "{{json .}}"');
        if (!stdout.trim()) return { status: 'down' as const, running: 0, total: 0 };

        const lines = stdout.trim().split('\n');
        let running = 0;
        let total = 0;

        for (const line of lines) {
            const parsed = JSON.parse(line);
            const name = parsed.Names || '';
            if (name.startsWith('cms-') || name.includes('cms')) {
                total++;
                if (parsed.State === 'running') running++;
            }
        }

        const status = total === 0 ? 'down' as const
            : running === total ? 'ok' as const
            : running === 0 ? 'down' as const
            : 'degraded' as const;

        return { status, running, total };
    } catch {
        return { status: 'down' as const, running: 0, total: 0 };
    }
}

export async function updateServer() {
    await ensurePermission('all');
    try {
        const rootDir = getRepoRoot();
        await logToDiscord('Server Update', 'Admin triggered a server update.', 16753920, true);
        
        // Run update in background to avoid timeout
        const scriptPath = path.join(rootDir, 'scripts/update-server.sh');
        // We use spawn to let it run detached if needed, but here we want some feedback.
        // Given Next.js server limits, a long running process might time out the request.
        // We'll start it and return immediately.
        
        const cmd = `nohup ${scriptPath} > ${path.join(rootDir, 'update.log')} 2>&1 &`;
        await execPromise(cmd);

        return { success: true, message: 'Server update started in background. Check logs or wait a few minutes.' };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}