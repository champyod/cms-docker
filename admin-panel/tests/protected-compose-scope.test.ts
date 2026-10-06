import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { PROTECTED_CONTAINER_NAMES } from '@/lib/protected-containers';
import {
  PROTECTED_COMPOSE_SERVICES,
  STACK_SERVICES,
  buildComposeCommand,
  scopedServiceList,
  type ComposeAction,
  type ComposeService,
} from '@/lib/compose-command';
import { buildRestartCommand } from '@/lib/restart-planner';

/**
 * The two halves of the container boundary have to agree with the compose files.
 *
 * Why this file exists: the name guard in lib/protected-containers.ts is consulted per container id,
 * and a stack action carries none — so nothing in that guard can catch a protected service being
 * added to, or renamed in, the unified project. These tests read the compose files themselves and
 * fail when the two hand-maintained lists drift from what a deployment actually declares.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILES = '-f docker-compose.yml';

/** The stacks whose containers are the deployment's ingress and key boundary. */
const INGRESS_FILES: readonly string[] = ['docker-compose.domain.yml', 'docker-compose.waf.yml'];

const readCompose = (file: string): string => fs.readFileSync(path.join(REPO_ROOT, file), 'utf-8');

/** service -> container_name, read from a compose file's `services:` block. */
function serviceContainerNames(source: string): Map<string, string> {
  const names = new Map<string, string>();
  let inServices = false;
  let service: string | null = null;
  for (const line of source.split('\n')) {
    if (/^[A-Za-z0-9_-]+:/.test(line)) {
      inServices = line.startsWith('services:');
      service = null;
      continue;
    }
    if (!inServices) continue;
    const opened = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (opened) {
      service = opened[1];
      continue;
    }
    const containerName = /^ {4}container_name:\s*(\S+)\s*$/.exec(line);
    if (containerName && service !== null) names.set(service, containerName[1]);
  }
  return names;
}

const knownServices: readonly string[] = [
  ...STACK_SERVICES.core,
  ...STACK_SERVICES.admin,
  ...STACK_SERVICES.contest,
];

describe('the protected name list matches the ingress stacks it claims to cover', () => {
  it('lists exactly the containers those stacks declare', (): void => {
    const declared = INGRESS_FILES
      .flatMap((file) => [...serviceContainerNames(readCompose(file)).values()])
      .sort();

    // Why equality and not "contains": a container added to the domain or WAF stack is unprotected
    // until someone remembers the list, so the omission has to fail a test rather than a review.
    expect(declared).toEqual([...PROTECTED_CONTAINER_NAMES].sort());
  });
});

describe('the protected service list matches the unified project', () => {
  it('names every unified-project service whose container is protected', (): void => {
    const unified = serviceContainerNames(readCompose('docker-compose.yml'));
    const protectedServices = [...unified.entries()]
      .filter(([, containerName]) => PROTECTED_CONTAINER_NAMES.includes(containerName))
      .map(([service]) => service);

    expect(protectedServices.sort()).toEqual([...PROTECTED_COMPOSE_SERVICES].sort());
  });
});

describe('no stack scope names a protected service', () => {
  it('is non-empty and free of protected services for every stack the panel offers', (): void => {
    for (const stack of ['core', 'admin', 'contest'] as const) {
      const scope = scopedServiceList(STACK_SERVICES[stack]);
      // Why non-empty: an empty scope means the whole enabled project, which is the reach this
      // whole change exists to remove.
      expect(scope.length).toBeGreaterThan(0);
      for (const service of PROTECTED_COMPOSE_SERVICES) expect(scope).not.toContain(service);
    }
  });
});

const ACTIONS: readonly ComposeAction[] = ['up', 'down', 'restart', 'build'];
const STACKS: readonly (ComposeService | undefined)[] = [undefined, 'core', 'admin', 'contest'];

describe('every compose command the panel can build is scoped and cannot reach a protected service', () => {
  it('names at least one service, and never a protected one', (): void => {
    for (const action of ACTIONS) {
      for (const stack of STACKS) {
        // An all-stack build names the worker fleet, which the panel refuses by design.
        if (action === 'build' && stack === undefined) continue;
        const command = buildComposeCommand(action, stack, { files: FILES, mode: 'img', location: null });
        expect(command.split(/\s+/).some(token => knownServices.includes(token))).toBe(true);
        for (const service of PROTECTED_COMPOSE_SERVICES) expect(command).not.toContain(service);
      }
    }
  });
});

describe('the restart planner cannot reach a protected service either', () => {
  it('scopes a stack restart', async (): Promise<void> => {
    for (const type of ['core', 'admin', 'all'] as const) {
      const plan = await buildRestartCommand(type, undefined, FILES, 'img', null);
      expect(plan.skip).toBe(false);
      if (plan.skip) continue;
      expect(plan.command.split(/\s+/).some(token => knownServices.includes(token))).toBe(true);
      for (const service of PROTECTED_COMPOSE_SERVICES) expect(plan.command).not.toContain(service);
    }
  });

  it('reports a custom restart that names only a protected service as nothing to do', async (): Promise<void> => {
    const plan = await buildRestartCommand('custom', [...PROTECTED_COMPOSE_SERVICES], FILES, 'img', null);

    // Why skip rather than an empty command: the plan is executed as a shell string, so producing
    // nothing to run would be a failure at the exec rather than a refusal at the plan.
    expect(plan.skip).toBe(true);
  });
});
