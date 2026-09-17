import { describe, expect, it } from 'vitest';
import { buildRestartCommand } from '../src/lib/restart-planner';
import type { DeploymentMode } from '../src/lib/deployment-mode';

const files = '-f docker-compose.core.yml -f docker-compose.admin.yml -f docker-compose.contest.yml -f docker-compose.monitor.yml';

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
      command: `bash scripts/__admin_worker_control.sh restart && docker compose ${files} up -d --build`,
    });
  });
});

interface BranchCase {
  name: string;
  type: 'core' | 'admin' | 'all';
  img: string;
  src: string;
}

// Pinned per branch, not derived from the implementation: a change to one branch's flags has to
// fail here instead of silently riding along in the shared builder.
const BRANCHES: BranchCase[] = [
  {
    name: 'core',
    type: 'core',
    img: '(docker compose -f docker-compose.core.yml pull || true) && docker compose -f docker-compose.core.yml up -d --no-build --force-recreate',
    src: 'docker compose -f docker-compose.core.yml up -d --build --force-recreate',
  },
  {
    name: 'admin',
    type: 'admin',
    img: '(docker compose -f docker-compose.admin.yml pull || true) && docker compose -f docker-compose.admin.yml up -d --no-build --force-recreate',
    src: 'docker compose -f docker-compose.admin.yml up -d --build --force-recreate',
  },
  {
    name: 'all',
    type: 'all',
    img: `bash scripts/__admin_worker_control.sh restart && (docker compose ${files} pull || true) && docker compose ${files} up -d --no-build`,
    src: `bash scripts/__admin_worker_control.sh restart && docker compose ${files} up -d --build`,
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

  it('img: a custom service list is pulled and recreated without building', async (): Promise<void> => {
    expect(await buildRestartCommand('custom', ['monitor'], files, 'img')).toEqual({
      skip: false,
      command: `(docker compose ${files} pull monitor || true) && docker compose ${files} up -d --no-build --force-recreate monitor`,
    });
  });

  it('src: a custom service list is built and recreated', async (): Promise<void> => {
    expect(await buildRestartCommand('custom', ['monitor'], files, 'src')).toEqual({
      skip: false,
      command: `docker compose ${files} up -d --build --force-recreate monitor`,
    });
  });

  it('img: a contest-stack restart pulls and keeps the worker fleet out of the build', async (): Promise<void> => {
    expect(await buildRestartCommand('custom', ['contest-stack'], files, 'img')).toEqual({
      skip: false,
      command: `bash scripts/__admin_worker_control.sh restart && (docker compose ${files} pull || true) && docker compose ${files} up -d --no-build --remove-orphans --force-recreate`,
    });
  });

  it('src: a contest-stack restart builds and recreates', async (): Promise<void> => {
    expect(await buildRestartCommand('custom', ['contest-stack'], files, 'src')).toEqual({
      skip: false,
      command: `bash scripts/__admin_worker_control.sh restart && docker compose ${files} up -d --build --remove-orphans --force-recreate`,
    });
  });
});
