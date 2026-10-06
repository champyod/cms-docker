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

export function collectContestServices(filteredList: string[], policies: RestartPolicies | null): string[] {
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

export async function analyzeContainerDependencies(containerNames: string[]): Promise<string[]> {
  // Why: container bulk restart must preview transitive dependents (database -> log service -> workers) so operator sees full impact before confirming
  const policies = await getRestartPolicies();
  if (!policies) return [...containerNames];
  const expanded = new Set<string>(containerNames);
  const queue = [...containerNames];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    const key = current.startsWith('cms-contest-web-server-') ? 'cms-contest-web-server' : current;
    const dependents = policies.dependencies[key] ?? policies.dependencies[current];
    if (dependents) {
      for (const dependent of dependents) {
        if (!expanded.has(dependent)) {
          expanded.add(dependent);
          queue.push(dependent);
        }
      }
    }
  }
  return Array.from(expanded);
}
