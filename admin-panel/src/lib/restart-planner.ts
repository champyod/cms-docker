import fs from 'fs/promises';
import path from 'path';
import { getRepoRoot } from './repo-root';
import { buildWorkerControlCommand } from './compose-command';
import type { DeploymentMode } from './deployment-mode';

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

/** One compose invocation the panel runs, described the way the Makefile's stack targets are. */
interface ComposeRestartTarget {
  /** The `-f` list the pull and the recreate run against. */
  files: string;
  /** Flags specific to this stack's recreate, in the order the panel already used them. */
  upFlags: readonly string[];
  /** Services both commands are scoped to; empty means the whole project. */
  services: readonly string[];
}

const CORE_RESTART: ComposeRestartTarget = {
  files: '-f docker-compose.core.yml',
  upFlags: ['--force-recreate'],
  services: [],
};

const ADMIN_RESTART: ComposeRestartTarget = {
  files: '-f docker-compose.admin.yml',
  upFlags: ['--force-recreate'],
  services: [],
};

/**
 * Renders one compose restart for a deployment mode, mirroring the Makefile's stack targets:
 * img pulls then recreates with --no-build, src builds and recreates in one step. Building when
 * the deployment meant to pull is what replaces a registry image with a local build, so the mode —
 * not a hardcoded flag — decides.
 *
 * The pull is best-effort, exactly like the Makefile's `pull || true`: the host may already hold
 * the image the stack should run, and the recreate is what the operator asked for, so a registry
 * outage must not skip it. The pull is parenthesised so `&&` binds to the group — the flat form
 * `pull || true && up` also recreates, but it would swallow a failure of a preceding step (the
 * worker fleet in the 'all' plan) into `true` and still run the compose half against a broken fleet.
 */
function buildComposeRestart(target: ComposeRestartTarget, mode: DeploymentMode): string {
  const scope = target.services.length > 0 ? ` ${target.services.join(' ')}` : '';
  const recreate = [
    'docker compose',
    target.files,
    'up -d',
    mode === 'img' ? '--no-build' : '--build',
    ...target.upFlags,
  ].join(' ') + scope;

  if (mode === 'src') {
    return recreate;
  }
  return `(docker compose ${target.files} pull${scope} || true) && ${recreate}`;
}

async function buildCustomRestartCommand(
  customList: string[],
  files: string,
  mode: DeploymentMode,
): Promise<RestartCommandPlan> {
  const needsContestStack = customList.includes('contest-stack') || customList.some(s => s.startsWith('cms-contest-web-server'));
  // Why: filter keeps only safe service names and strips contest-stack sentinel so docker compose receives valid service identifiers
  const filteredList = customList.filter(s => s !== 'contest-stack' && /^[a-zA-Z0-9_-]+$/.test(s));

  if (filteredList.length === 0 && !needsContestStack) {
    return { skip: true, message: 'Nothing to restart.' };
  }

  const policies = await getRestartPolicies();
  const services = collectContestServices(filteredList, policies);
  const isWorker = (service: string): boolean => /^(?:worker|cms-worker(?:-\d+)?)$/.test(service);
  const workers = services.filter(isWorker);
  const contestServices = services.filter(service => !isWorker(service));
  const commands: string[] = [];
  // A contest-stack recreation previously included workers through the merged
  // files; keep that coverage without handing them to the non-fleet project.
  if (needsContestStack || workers.length > 0) {
    const allWorkers = needsContestStack || workers.some(service => service === 'worker' || service === 'cms-worker');
    commands.push(buildWorkerControlCommand('restart', allWorkers ? [] : workers.map(service => service.slice('cms-worker-'.length))));
  }
  if (needsContestStack) {
    commands.push(buildComposeRestart({ files, upFlags: ['--remove-orphans', '--force-recreate'], services: [] }, mode));
  } else if (contestServices.length > 0) {
    commands.push(buildComposeRestart({ files, upFlags: ['--force-recreate'], services: contestServices }, mode));
  }
  return { skip: false, command: commands.join(' && ') };
}

export async function buildRestartCommand(
  type: 'all' | 'core' | 'admin' | 'worker' | 'custom',
  customList: string[] | undefined,
  files: string,
  mode: DeploymentMode,
): Promise<RestartCommandPlan> {
  if (type === 'core') {
    return { skip: false, command: buildComposeRestart(CORE_RESTART, mode) };
  }
  if (type === 'admin') {
    return { skip: false, command: buildComposeRestart(ADMIN_RESTART, mode) };
  }
  if (type === 'worker') {
    return { skip: false, command: buildWorkerControlCommand('restart') };
  }
  if (type === 'custom' && customList && customList.length > 0) {
    return buildCustomRestartCommand(customList, files, mode);
  }
  const workerCommand = buildWorkerControlCommand('restart');
  const composeRestart = buildComposeRestart({ files, upFlags: [], services: [] }, mode);
  return { skip: false, command: `${workerCommand} && ${composeRestart}` };
}
