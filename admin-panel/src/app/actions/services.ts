'use server';

import fs from 'fs/promises';
import path from 'path';
import { exec, spawn } from 'child_process';
import util from 'util';
import crypto from 'crypto';
import { ensurePermission } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';

const execPromise = util.promisify(exec);

const getRepoRoot = () => process.env.IS_DOCKER === 'true' ? '/repo-root' : path.resolve(process.cwd(), '..');

async function logToDiscord(title: string, message: string, color: number = 3447003, mention: boolean = false) {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) return;

    try {
        const roleId = process.env.DISCORD_ROLE_ID;
        const payload: { embeds: Array<{ title: string; description: string; color: number; timestamp: string }>; content?: string } = {
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

async function getContestComposeFile(): Promise<string> {
    return 'docker-compose.contest.yml';
}

// ---------------------------------------------------------------------------
// Deploy infrastructure helpers
// ---------------------------------------------------------------------------

const getDeployLogsDir = () => path.join(getRepoRoot(), 'logs', 'deploy');

async function ensureDeployLogsDir(): Promise<void> {
  await fs.mkdir(getDeployLogsDir(), { recursive: true });
}

function generateOperationId(): string {
  return crypto.randomBytes(8).toString('hex');
}

async function getActiveOperationId(): Promise<string | null> {
  try {
    const lockPath = path.join(getDeployLogsDir(), 'active.lock');
    return await fs.readFile(lockPath, 'utf-8');
  } catch {
    return null;
  }
}

async function setActiveOperationId(operationId: string): Promise<void> {
  const lockPath = path.join(getDeployLogsDir(), 'active.lock');
  await fs.writeFile(lockPath, operationId, 'utf-8');
}

async function clearActiveOperation(): Promise<void> {
  const lockPath = path.join(getDeployLogsDir(), 'active.lock');
  await fs.unlink(lockPath).catch(() => {});
}

async function cleanStaleOperations(): Promise<void> {
  const dir = getDeployLogsDir();
  const STALE_MS = 30 * 60 * 1000;
  try {
    const files = await fs.readdir(dir);
    const jsonFiles = files.filter((f) => f.endsWith('.json'));
    for (const jsonFile of jsonFiles) {
      const filePath = path.join(dir, jsonFile);
      const raw = await fs.readFile(filePath, 'utf-8').catch(() => null);
      if (!raw) continue;
      const meta = JSON.parse(raw) as { startedAt: string };
      const age = Date.now() - new Date(meta.startedAt).getTime();
      if (age > STALE_MS) {
        const opId = jsonFile.replace('.json', '');
        await fs.unlink(path.join(dir, `${opId}.json`)).catch(() => {});
        await fs.unlink(path.join(dir, `${opId}.log`)).catch(() => {});
        await fs.unlink(path.join(dir, `${opId}.done`)).catch(() => {});
        await fs.unlink(path.join(dir, `${opId}.error`)).catch(() => {});
        const active = await getActiveOperationId();
        if (active === opId) await clearActiveOperation();
      }
    }
  } catch {
    // Non-fatal: stale cleanup is best-effort
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

export async function getLiveServiceConnections() {
    await ensurePermission('all');
    try {
        type LiveServiceConnection = {
            name: string;
            shard: number;
            address: string;
            port: number;
        };

        // Query the services table which LogService maintains
        // Note: 'services' table is not in Prisma schema, so we use $queryRaw
        const services = await prisma.$queryRaw<LiveServiceConnection[]>`
            SELECT name, shard, address, port FROM services ORDER BY name, shard;
        `;
        
        return { success: true, services };
    } catch (error) {
        console.error('Failed to fetch live service connections:', error);
        // If table doesn't exist yet (first boot), return empty
        return { success: true, services: [] };
    }
}

export async function restartServices(type: 'all' | 'core' | 'admin' | 'worker' | 'custom', customList?: string[]) {
  await ensurePermission('all');
  try {
    const rootDir = getRepoRoot();
    let cmd = '';
        const contestComposeFile = await getContestComposeFile();

    // Regenerate env and contest compose
    await execPromise('make env', { cwd: rootDir });

    const files = [
        'docker-compose.core.yml',
        'docker-compose.admin.yml',
        'docker-compose.worker.yml',
        contestComposeFile,
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

/** @deprecated Use deployContest() instead for async, non-blocking deploys. */
export async function saveAndRestartContest(contestId: number) {
  await ensurePermission('all');
  try {
    const rootDir = getRepoRoot();
    const { writeActiveContestId } = await import('./env');
    const result = await writeActiveContestId(contestId);
    if (!result.success) return { success: false, error: 'Failed to update contest env file' };

    const cmd = `docker compose -f docker-compose.contest.yml up -d --build --force-recreate`;

    await logToDiscord('Contest Restart', `Admin activated contest ID **${contestId}** and restarted contest stack.`, 16753920, true);

    const { stdout, stderr } = await execPromise(cmd, { cwd: rootDir, timeout: 120000 });

    if (stderr && stderr.includes('error')) {
      return { success: false, error: stderr };
    }

    return { success: true, message: `Contest ${contestId} activated and stack restarted.`, output: stdout };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export interface DeployContestResult {
  success: boolean;
  operationId?: string;
  error?: string;
  alreadyRunning?: boolean;
}

export async function deployContest(contestId: number): Promise<DeployContestResult> {
  await ensurePermission('all');
  try {
    await ensureDeployLogsDir();
    await cleanStaleOperations();

    const existingOp = await getActiveOperationId();
    if (existingOp !== null) {
      return { success: false, alreadyRunning: true, error: 'A deploy is already in progress.' };
    }

    const { activateContest } = await import('./contests');
    const activateResult = await activateContest(contestId);
    if (!activateResult.success) {
      return { success: false, error: activateResult.error };
    }

    const { writeActiveContestId } = await import('./env');
    const envResult = await writeActiveContestId(contestId);
    if (!envResult.success) {
      return { success: false, error: 'Failed to write .env.contest: ' + envResult.error };
    }

    const operationId = generateOperationId();
    const rootDir = getRepoRoot();
    const logsDir = getDeployLogsDir();
    const metaPath = path.join(logsDir, `${operationId}.json`);
    const logPath = path.join(logsDir, `${operationId}.log`);
    const donePath = path.join(logsDir, `${operationId}.done`);
    const errorPath = path.join(logsDir, `${operationId}.error`);

    await fs.writeFile(
      metaPath,
      JSON.stringify({ contestId, startedAt: new Date().toISOString(), status: 'running' }),
      'utf-8'
    );
    await setActiveOperationId(operationId);

    const shellCmd = [
      `docker compose -f docker-compose.contest.yml up -d --build --force-recreate`,
      `> "${logPath}" 2>&1`,
      `&& echo "ok" > "${donePath}"`,
      `|| echo "$?" > "${errorPath}"`,
    ].join(' ');

    const child = spawn('sh', ['-c', shellCmd], {
      cwd: rootDir,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    await logToDiscord(
      'Contest Deploy Started',
      `Admin triggered async deploy for contest ID **${contestId}**. Operation: \`${operationId}\``,
      16753920,
      true
    );

    return { success: true, operationId };
  } catch (error) {
    await clearActiveOperation().catch(() => {});
    return { success: false, error: (error as Error).message };
  }
}

export type DeployStatus = 'running' | 'completed' | 'failed' | 'not_found' | 'timeout';

export interface DeployStatusResult {
  success: boolean;
  status: DeployStatus;
  contestId?: number;
  startedAt?: string;
  log?: string;
  error?: string;
}

const DEPLOY_TIMEOUT_MS = 120_000;

export async function getDeployStatus(operationId: string): Promise<DeployStatusResult> {
  await ensurePermission('all');

  if (!/^[0-9a-f]{16}$/.test(operationId)) {
    return { success: false, status: 'not_found', error: 'Invalid operation ID.' };
  }

  const logsDir = getDeployLogsDir();
  const metaPath = path.join(logsDir, `${operationId}.json`);
  const logPath = path.join(logsDir, `${operationId}.log`);
  const donePath = path.join(logsDir, `${operationId}.done`);
  const errorPath = path.join(logsDir, `${operationId}.error`);

  const rawMeta = await fs.readFile(metaPath, 'utf-8').catch(() => null);
  if (rawMeta === null) {
    return { success: false, status: 'not_found', error: 'Operation not found.' };
  }

  const meta = JSON.parse(rawMeta) as { contestId: number; startedAt: string };
  const elapsedMs = Date.now() - new Date(meta.startedAt).getTime();
  const log = await fs.readFile(logPath, 'utf-8').catch(() => '');

  if (elapsedMs > DEPLOY_TIMEOUT_MS) {
    await clearActiveOperation();
    return {
      success: false,
      status: 'timeout',
      contestId: meta.contestId,
      startedAt: meta.startedAt,
      log,
      error: 'Deploy timed out after 120 seconds.',
    };
  }

  const isDone = await fs.access(donePath).then(() => true).catch(() => false);
  if (isDone) {
    await clearActiveOperation();
    await logToDiscord(
      'Contest Deploy Completed',
      `Contest ID **${meta.contestId}** deployed successfully.`,
      3066993
    );
    return {
      success: true,
      status: 'completed',
      contestId: meta.contestId,
      startedAt: meta.startedAt,
      log,
    };
  }

  const errorContent = await fs.readFile(errorPath, 'utf-8').catch(() => null);
  if (errorContent !== null) {
    await clearActiveOperation();
    await logToDiscord(
      'Contest Deploy Failed',
      `Contest ID **${meta.contestId}** deploy failed. Exit code: ${errorContent.trim()}`,
      15158332,
      true
    );
    return {
      success: false,
      status: 'failed',
      contestId: meta.contestId,
      startedAt: meta.startedAt,
      log,
      error: `Docker process exited with code ${errorContent.trim()}.`,
    };
  }

  return {
    success: true,
    status: 'running',
    contestId: meta.contestId,
    startedAt: meta.startedAt,
    log,
  };
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
