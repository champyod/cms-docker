import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { buildComposeCommand, type ComposeAction, type ComposeService } from '@/lib/compose-command';
import type { HostComposeLocation } from '@/lib/compose-location';
import type { DeploymentMode } from '@/lib/deployment-mode';

// What app/actions/docker.ts passes: the unified project, the mode from config.toml, and — inside the
// panel container — the host repository path compose needs for the relative bind sources. On the host
// the location is null, which is the shape every command below has unless a test says otherwise.
const FILES = '-f docker-compose.yml';

const HOST_CONTAINERISED: HostComposeLocation = {
  projectDirectory: '/host/contest system',
  envFile: '/repo-root/.env',
};
const HOST_LOCATION_FLAGS = `--project-directory '/host/contest system' --env-file '/repo-root/.env'`;

const compose = (
  action: ComposeAction,
  service: ComposeService | undefined,
  mode: DeploymentMode,
  location: HostComposeLocation | null = null,
): string => buildComposeCommand(action, service, { files: FILES, mode, location });

describe('the stack controls run the unified project in the deployment mode', () => {
  it('img: an up pulls, then recreates without building', (): void => {
    expect(compose('up', 'admin', 'img')).toBe(
      `(docker compose ${FILES} --profile core --profile admin pull || true) && docker compose ${FILES} --profile core --profile admin up -d --no-build`,
    );
  });

  it('src: an up builds from source and does not pull', (): void => {
    expect(compose('up', 'admin', 'src')).toBe(
      `docker compose ${FILES} --profile core --profile admin up -d --build`,
    );
  });

  it('img: core pulls under its own profile, which needs no other', (): void => {
    expect(compose('up', 'core', 'img')).toBe(
      `(docker compose ${FILES} --profile core pull || true) && docker compose ${FILES} --profile core up -d --no-build`,
    );
  });

  it('src: the contest stack builds under core and contest', (): void => {
    expect(compose('up', 'contest', 'src')).toBe(
      `docker compose ${FILES} --profile core --profile contest up -d --build && bash scripts/__contest_dns_refresh.sh`,
    );
  });

  // The page's 'all' control covers the stacks it offers buttons for; the worker fleet keeps its own
  // containers, so it is started through the fleet script rather than recreated by compose.
  it('src: an all-up starts the fleet, then builds every offered stack', (): void => {
    expect(compose('up', undefined, 'src')).toBe(
      `bash scripts/__admin_worker_control.sh start && docker compose ${FILES} --profile core --profile admin --profile contest up -d --build && bash scripts/__contest_dns_refresh.sh`,
    );
  });

  it('img: an all-up starts the fleet, then pulls and recreates', (): void => {
    expect(compose('up', undefined, 'img')).toBe(
      `bash scripts/__admin_worker_control.sh start && (docker compose ${FILES} --profile core --profile admin --profile contest pull || true) && docker compose ${FILES} --profile core --profile admin --profile contest up -d --no-build && bash scripts/__contest_dns_refresh.sh`,
    );
  });
});

// Core is enabled next to admin and contest for depends_on validation only, so the operations that
// name what they act on have to name it: an unscoped down/restart/build would reach the database.
describe('scoped operations name the stack\u2019s own services', () => {
  it('down on the admin stack leaves core running', (): void => {
    expect(compose('down', 'admin', 'img')).toBe(
      `docker compose ${FILES} --profile core --profile admin down admin-panel-next admin-web-server ranking-web-server`,
    );
  });

  it('restart on the contest stack leaves core running', (): void => {
    expect(compose('restart', 'contest', 'img')).toBe(
      `docker compose ${FILES} --profile core --profile contest restart evaluation-service proxy-service contest-web-server nginx-proxy`,
    );
  });

  // An explicit build asks for a local image, so it takes no mode flag; core's own stack is the whole
  // core profile, which is why nothing is named here.
  it('build on core builds the core profile', (): void => {
    expect(compose('build', 'core', 'img')).toBe(`docker compose ${FILES} --profile core build --no-cache`);
  });

  it('down on all covers the core profile as a whole', (): void => {
    expect(compose('down', undefined, 'img')).toBe(
      `bash scripts/__admin_worker_control.sh stop && docker compose ${FILES} --profile core --profile admin --profile contest down`,
    );
  });
});

describe('the worker stack is never handed to compose', () => {
  it('up starts the existing fleet containers', (): void => {
    expect(compose('up', 'worker', 'img')).toBe('bash scripts/__admin_worker_control.sh start');
  });

  it('restart restarts the existing fleet containers', (): void => {
    expect(compose('restart', 'worker', 'src')).toBe('bash scripts/__admin_worker_control.sh restart');
  });

  it('build refuses rather than recreating the fleet from a foreign project', (): void => {
    expect(() => compose('build', 'worker', 'img')).toThrow(/make worker on the host/);
    expect(() => compose('build', undefined, 'img')).toThrow(/make worker on the host/);
  });

  it('rejects an action or stack the page does not offer', (): void => {
    expect(() => buildComposeCommand('deploy' as ComposeAction, 'core', { files: FILES, mode: 'img', location: null })).toThrow(/Invalid compose action/);
    expect(() => buildComposeCommand('up', 'monitor' as ComposeService, { files: FILES, mode: 'img', location: null })).toThrow(/Invalid compose action/);
  });
});

describe('a containerised panel hands compose the host repository', () => {
  it('img: every compose step of the pull-and-recreate leads with the location', (): void => {
    expect(compose('up', 'admin', 'img', HOST_CONTAINERISED)).toBe(
      `(docker compose ${HOST_LOCATION_FLAGS} ${FILES} --profile core --profile admin pull || true) && docker compose ${HOST_LOCATION_FLAGS} ${FILES} --profile core --profile admin up -d --no-build`,
    );
  });

  it('src: the recreate leads with the location', (): void => {
    expect(compose('up', 'contest', 'src', HOST_CONTAINERISED)).toBe(
      `docker compose ${HOST_LOCATION_FLAGS} ${FILES} --profile core --profile contest up -d --build && bash scripts/__contest_dns_refresh.sh`,
    );
  });

  it('a scoped restart leads with the location', (): void => {
    expect(compose('restart', 'admin', 'img', HOST_CONTAINERISED)).toBe(
      `docker compose ${HOST_LOCATION_FLAGS} ${FILES} --profile core --profile admin restart admin-panel-next admin-web-server ranking-web-server`,
    );
  });
});

// The partial docker-compose.<stack>.yml files this page used to assemble: they declare locally
// derived image names that no registry serves and omit the profiles, so both an image-mode pull and a
// source build against them end up somewhere else than the make targets do.
describe('no command names a partial stack file, and every profile is one the project declares', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

  const declarations = async (): Promise<string> => fs.readFile(path.join(repoRoot, 'docker-compose.yml'), 'utf-8');
  const declaredProfiles = (composeFile: string): Set<string> =>
    new Set([...composeFile.matchAll(/^\s+- (core|admin|contest|worker|monitor)\s*$/gm)].map(match => match[1]));

  const ACTIONS: readonly ComposeAction[] = ['up', 'down', 'restart', 'build'];
  const STACKS: readonly (ComposeService | undefined)[] = [undefined, 'core', 'admin', 'contest'];
  const MODES: readonly DeploymentMode[] = ['img', 'src'];

  it('names the base project file and a declared profile, in every combination', async (): Promise<void> => {
    const profiles = declaredProfiles(await declarations());
    expect(profiles.size).toBeGreaterThan(0);

    for (const action of ACTIONS) {
      for (const stack of STACKS) {
        // An all-stack build names the worker fleet, which the panel refuses (asserted below).
        if (action === 'build' && stack === undefined) continue;
        for (const mode of MODES) {
          const command = compose(action, stack, mode);
          expect(command).toContain(FILES);
          expect(command).not.toMatch(/docker-compose\.(core|admin|contest|monitor|worker)\.yml/);
          expect(command).toMatch(/--profile (core|admin|contest)/);
          for (const match of command.matchAll(/--profile (\w+)/g)) {
            expect(profiles).toContain(match[1]);
          }
        }
      }
    }
  });

  it('names services the project declares, and no service of another stack', async (): Promise<void> => {
    const composeFile = await declarations();
    const services = new Set([...composeFile.matchAll(/^  ([a-z0-9-]+):$/gm)].map(match => match[1]));

    for (const action of ['down', 'restart', 'build'] as const) {
      for (const stack of ['admin', 'contest'] as const) {
        const command = compose(action, stack, 'img');
        const named = command
          .slice(command.indexOf(` ${action}`) + action.length + 1)
          .split(' ')
          .filter(token => token.length > 0 && !token.startsWith('-'));
        expect(named.length).toBeGreaterThan(0);
        for (const service of named) expect(services).toContain(service);
        expect(named).not.toContain('database');
      }
    }
  });
});
