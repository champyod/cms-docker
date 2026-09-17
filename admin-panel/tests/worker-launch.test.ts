import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { COMPOSE_BASE_FILE, COMPOSE_OVERRIDE_FILE, buildComposeFileFlags, buildRestartCommand } from '../src/lib/restart-planner';
import type { DeploymentMode } from '../src/lib/deployment-mode';

// What services.ts passes: the unified project the make targets and ./cms deploy. The partial
// stack files are gone from the restart path — they declare locally-built image names that no
// registry serves, so image mode could only fail against them.
const files = '-f docker-compose.yml';
const ALL_PROFILES = '--profile core --profile admin --profile contest --profile monitor';

describe('fleet worker restart commands', () => {
  it('restarts existing fleet containers without compose recreation', async (): Promise<void> => {
    expect(await buildRestartCommand('worker', undefined, files, 'img')).toEqual({
      skip: false,
      command: 'bash scripts/__admin_worker_control.sh restart',
    });
  });

  it('does not let the deployment mode change the fleet command', async (): Promise<void> => {
    expect(await buildRestartCommand('worker', undefined, files, 'src')).toEqual({
      skip: false,
      command: 'bash scripts/__admin_worker_control.sh restart',
    });
  });

  it('keeps fleet workers separate from the all-services compose project', async (): Promise<void> => {
    expect(await buildRestartCommand('all', undefined, files, 'src')).toEqual({
      skip: false,
      command: `bash scripts/__admin_worker_control.sh restart && docker compose ${files} ${ALL_PROFILES} up -d --build`,
    });
  });
});

interface BranchCase {
  name: string;
  type: 'core' | 'admin' | 'all';
  img: string;
  src: string;
}

// Pinned per branch, not derived from the implementation: a change to one branch's file, profile
// or flags has to fail here instead of silently riding along in the shared builder. The profiles
// are the ones the matching make target selects: `make core` uses core, `make admin` adds core to
// admin, and an 'all' restart covers every stack but the per-shard worker fleet.
const BRANCHES: BranchCase[] = [
  {
    name: 'core',
    type: 'core',
    img: '(docker compose -f docker-compose.yml --profile core pull || true) && docker compose -f docker-compose.yml --profile core up -d --no-build --force-recreate',
    src: 'docker compose -f docker-compose.yml --profile core up -d --build --force-recreate',
  },
  {
    name: 'admin',
    type: 'admin',
    img: '(docker compose -f docker-compose.yml --profile core --profile admin pull || true) && docker compose -f docker-compose.yml --profile core --profile admin up -d --no-build --force-recreate',
    src: 'docker compose -f docker-compose.yml --profile core --profile admin up -d --build --force-recreate',
  },
  {
    name: 'all',
    type: 'all',
    img: `bash scripts/__admin_worker_control.sh restart && (docker compose ${files} ${ALL_PROFILES} pull || true) && docker compose ${files} ${ALL_PROFILES} up -d --no-build`,
    src: `bash scripts/__admin_worker_control.sh restart && docker compose ${files} ${ALL_PROFILES} up -d --build`,
  },
];

describe('restart follows DEPLOYMENT_TYPE', () => {
  for (const branch of BRANCHES) {
    it(`img: ${branch.name} pulls, then recreates without building`, async (): Promise<void> => {
      expect(await buildRestartCommand(branch.type, undefined, files, 'img')).toEqual({
        skip: false,
        command: branch.img,
      });
    });

    it(`src: ${branch.name} builds, then recreates`, async (): Promise<void> => {
      expect(await buildRestartCommand(branch.type, undefined, files, 'src')).toEqual({
        skip: false,
        command: branch.src,
      });
    });
  }

  it('never passes --build in img mode and never omits it in src mode', async (): Promise<void> => {
    const modes: readonly DeploymentMode[] = ['img', 'src'];
    for (const mode of modes) {
      for (const branch of BRANCHES) {
        const plan = await buildRestartCommand(branch.type, undefined, files, mode);
        expect(plan.skip).toBe(false);
        const command = plan.skip ? '' : plan.command;
        expect(command.includes('--build')).toBe(mode === 'src');
        expect(command.includes('--no-build')).toBe(mode === 'img');
      }
    }
  });

  // The exact request that failed on a real deployment: saving the Discord webhook restarts the
  // monitor, and the old partial-file command pulled a locally-named image (cms-monitor) that no
  // registry serves. The service is profile-gated, so the profile is what makes it resolvable.
  it('img: a custom service list is pulled and recreated without building', async (): Promise<void> => {
    expect(await buildRestartCommand('custom', ['monitor'], files, 'img')).toEqual({
      skip: false,
      command: `(docker compose ${files} --profile monitor pull monitor || true) && docker compose ${files} --profile monitor up -d --no-build --force-recreate monitor`,
    });
  });

  it('src: a custom service list is built and recreated', async (): Promise<void> => {
    expect(await buildRestartCommand('custom', ['monitor'], files, 'src')).toEqual({
      skip: false,
      command: `docker compose ${files} --profile monitor up -d --build --force-recreate monitor`,
    });
  });

  it('img: a contest-stack restart pulls and keeps the worker fleet out of the build', async (): Promise<void> => {
    expect(await buildRestartCommand('custom', ['contest-stack'], files, 'img')).toEqual({
      skip: false,
      command: `bash scripts/__admin_worker_control.sh restart && (docker compose ${files} --profile core --profile contest pull || true) && docker compose ${files} --profile core --profile contest up -d --no-build --remove-orphans --force-recreate`,
    });
  });

  it('src: a contest-stack restart builds and recreates', async (): Promise<void> => {
    expect(await buildRestartCommand('custom', ['contest-stack'], files, 'src')).toEqual({
      skip: false,
      command: `bash scripts/__admin_worker_control.sh restart && docker compose ${files} --profile core --profile contest up -d --build --remove-orphans --force-recreate`,
    });
  });
});

interface ProfileCase {
  name: string;
  requested: string[];
  profiles: string;
  services: string;
}

// Requests arrive in the two shapes the callers use: the maintenance UI names a compose service,
// while config/restart_policies.json names containers. Both have to reach compose as a service
// name with the profile that gates it enabled, or compose answers "no such service".
const PROFILE_CASES: ProfileCase[] = [
  {
    name: 'a container name of the admin profile, which core is required alongside',
    requested: ['cms-ranking-web-server'],
    profiles: '--profile core --profile admin',
    services: 'ranking-web-server',
  },
  {
    name: 'the one container whose name is not its service behind a cms- prefix',
    requested: ['cms-nginx-contest'],
    profiles: '--profile core --profile contest',
    services: 'nginx-proxy',
  },
  {
    name: 'services from several profiles',
    requested: ['cms-ranking-web-server', 'monitor'],
    profiles: '--profile core --profile admin --profile monitor',
    services: 'ranking-web-server monitor',
  },
];

describe('a scoped restart enables the profiles its services live in', () => {
  for (const profileCase of PROFILE_CASES) {
    it(`img: ${profileCase.name}`, async (): Promise<void> => {
      expect(await buildRestartCommand('custom', profileCase.requested, files, 'img')).toEqual({
        skip: false,
        command: `(docker compose ${files} ${profileCase.profiles} pull ${profileCase.services} || true) && docker compose ${files} ${profileCase.profiles} up -d --no-build --force-recreate ${profileCase.services}`,
      });
    });

    it(`src: ${profileCase.name}`, async (): Promise<void> => {
      expect(await buildRestartCommand('custom', profileCase.requested, files, 'src')).toEqual({
        skip: false,
        command: `docker compose ${files} ${profileCase.profiles} up -d --build --force-recreate ${profileCase.services}`,
      });
    });
  }

  it('never names a partial stack file and always enables a profile', async (): Promise<void> => {
    const modes: readonly DeploymentMode[] = ['img', 'src'];
    const calls: readonly { type: 'core' | 'admin' | 'all' | 'custom'; custom?: string[] }[] = [
      { type: 'core' },
      { type: 'admin' },
      { type: 'all' },
      { type: 'custom', custom: ['monitor'] },
      { type: 'custom', custom: ['contest-stack'] },
      ...PROFILE_CASES.map(profileCase => ({ type: 'custom' as const, custom: profileCase.requested })),
    ];
    for (const mode of modes) {
      for (const call of calls) {
        const plan = await buildRestartCommand(call.type, call.custom, files, mode);
        expect(plan.skip).toBe(false);
        const command = plan.skip ? '' : plan.command;
        expect(command).toContain('-f docker-compose.yml');
        expect(command).not.toMatch(/docker-compose\.(core|admin|contest|monitor|worker)\.yml/);
        expect(command).toMatch(/--profile (core|admin|contest|monitor)/);
      }
    }
  });
});

describe('compose file flags mirror the Makefile wildcard', () => {
  const tmpRoots: string[] = [];

  const makeTmpRoot = async (): Promise<string> => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cms-compose-flags-'));
    tmpRoots.push(root);
    return root;
  };

  afterAll(async (): Promise<void> => {
    await Promise.all(tmpRoots.map(root => fs.rm(root, { recursive: true, force: true })));
  });

  it('uses the base project file when the deployment has no override', async (): Promise<void> => {
    expect(await buildComposeFileFlags(await makeTmpRoot())).toBe(`-f ${COMPOSE_BASE_FILE}`);
  });

  // `-f` disables compose's automatic override merge, so a present override has to be listed.
  it('adds a present override file', async (): Promise<void> => {
    const root = await makeTmpRoot();
    await fs.writeFile(path.join(root, COMPOSE_OVERRIDE_FILE), 'services: {}\n');
    expect(await buildComposeFileFlags(root)).toBe(`-f ${COMPOSE_BASE_FILE} -f ${COMPOSE_OVERRIDE_FILE}`);
  });
});
