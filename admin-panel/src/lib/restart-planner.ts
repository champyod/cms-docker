import fs from 'fs/promises';
import path from 'path';
import { getRepoRoot } from './repo-root';

export interface RestartPolicies {
    dependencies: Record<string, string[]>;
    env_triggers: Record<string, string[]>;
}

export async function getRestartPolicies(): Promise<RestartPolicies | null> {
    const policyPath = path.join(getRepoRoot(), 'config', 'restart_policies.json');
    try {
        const content = await fs.readFile(policyPath, 'utf-8');
        return JSON.parse(content);
    } catch (e) {
        console.error('Failed to read restart policies:', e);
        return null;
    }
}

export type RestartCommandPlan =
  | { skip: true; message: string }
  | { skip: false; command: string };

function collectContestServices(filteredList: string[], policies: RestartPolicies | null): string[] {
  const contestServices: string[] = [];

  filteredList.forEach(service => {
    if (service.startsWith('cms-contest-web-server-')) {
      const contestId = service.replace('cms-contest-web-server-', '');
      contestServices.push(`cms-contest-web-server-${contestId}`);
      contestServices.push(`cms-ranking-web-server-${contestId}`);
    } else {
      contestServices.push(service);
    }

    const dependencyKey = service.startsWith('cms-contest-web-server-') ? 'cms-contest-web-server' : service;
    if (policies && policies.dependencies[dependencyKey]) {
      policies.dependencies[dependencyKey].forEach(dep => {
        if (!contestServices.includes(dep)) {
          contestServices.push(dep);
        }
      });
    }
  });

  return contestServices;
}

async function buildCustomRestartCommand(customList: string[], files: string): Promise<RestartCommandPlan> {
  const needsContestStack = customList.includes('contest-stack') || customList.some(s => s.startsWith('cms-contest-web-server'));
  const filteredList = customList.filter(s => s !== 'contest-stack' && /^[a-zA-Z0-9_-]+$/.test(s));

  if (needsContestStack) {
    return { skip: false, command: `docker compose ${files} up -d --remove-orphans --force-recreate` };
  }
  if (filteredList.length === 0) {
    return { skip: true, message: 'Nothing to restart.' };
  }

  const policies = await getRestartPolicies();
  const contestServices = collectContestServices(filteredList, policies);

  return { skip: false, command: `docker compose ${files} up -d --force-recreate ${contestServices.join(' ')}` };
}

export async function buildRestartCommand(
  type: 'all' | 'core' | 'admin' | 'worker' | 'custom',
  customList: string[] | undefined,
  files: string
): Promise<RestartCommandPlan> {
  if (type === 'core') {
    return { skip: false, command: 'docker compose -f docker-compose.core.yml up -d --build --force-recreate' };
  }
  if (type === 'admin') {
    return { skip: false, command: 'docker compose -f docker-compose.admin.yml up -d --build --force-recreate' };
  }
  if (type === 'worker') {
    return { skip: false, command: 'docker compose -f docker-compose.worker.yml up -d --build --force-recreate' };
  }
  if (type === 'custom' && customList && customList.length > 0) {
    return buildCustomRestartCommand(customList, files);
  }
  return { skip: false, command: `docker compose ${files} up -d --build` };
}
