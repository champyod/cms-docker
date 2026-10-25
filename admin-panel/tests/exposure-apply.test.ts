import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { applyExposureArtifacts, type FrontRunner } from '@/lib/exposure-apply';
import type { WiringPayload } from '@/lib/service-wiring-cli';

const roots: string[] = [];

async function workspace(): Promise<{ live: string; staging: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'cms-exposure-apply-'));
  roots.push(root);
  const live = path.join(root, 'generated');
  await mkdir(live, { recursive: true });
  return { live, staging: path.join(live, '.staging') };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const PAYLOAD: WiringPayload = {
  services: [
    { id: 1, name: 'web-1', role: 'ContestWebServer', shard: 0, host: 'web-1', http_port: 8888, rpc_port: 21000, db_profile: 'default', contest_id: 7, enabled: true },
  ],
  wirings: [],
  exposures: [{ service_id: 1, hostname: 'routes.example.com', path: '/', tls: false, tailnet: null }],
};

const PREVIOUS_ROUTES = '# routes rendered before this save\n';

interface FakeFront {
  readonly runner: FrontRunner;
  readonly calls: string[];
}

/** Records what the front was asked to do, and can fail one stage the way the real front would. */
function fakeFront(options: { failsAt?: 'test' | 'reload'; onTest?: (stagedDir: string) => Promise<void> } = {}): FakeFront {
  const calls: string[] = [];
  return {
    calls,
    runner: {
      testStagedConfig: async (stagedDir) => {
        calls.push('test');
        if (options.onTest !== undefined) await options.onTest(stagedDir);
        if (options.failsAt === 'test') {
          throw new Error('nginx: [emerg] unknown directive "proxy_pas" in /tmp/cms-staged/generated/contest-routes.conf:12');
        }
        return 'nginx: configuration file /tmp/cms-staged/nginx.conf test is successful';
      },
      reloadFront: async () => {
        calls.push('reload');
        if (options.failsAt === 'reload') {
          throw new Error('nginx: [error] invalid PID number "" in "/run/nginx.pid"');
        }
        return '';
      },
    },
  };
}

describe('applyExposureArtifacts', () => {
  it('renders to staging, tests it in the front, then swaps and reloads exactly once', async () => {
    const { live, staging } = await workspace();
    await writeFile(path.join(live, 'contest-routes.conf'), PREVIOUS_ROUTES);
    let liveDuringTest = '';
    let stagedDuringTest = '';
    const front = fakeFront({
      onTest: async (stagedDir) => {
        liveDuringTest = await readFile(path.join(live, 'contest-routes.conf'), 'utf8');
        stagedDuringTest = await readFile(path.join(stagedDir, 'contest-routes.conf'), 'utf8');
      },
    });

    const outcome = await applyExposureArtifacts(PAYLOAD, {
      liveDir: live,
      stagingDir: staging,
      frontVhosts: [],
      front: front.runner,
    });

    expect(outcome).toEqual({ kind: 'applied', changed: ['contest-routes.conf'] });
    // The front tested the staged bytes, so the live file still held the previous ones.
    expect(stagedDuringTest).toContain('server_name routes.example.com;');
    expect(liveDuringTest).toBe(PREVIOUS_ROUTES);
    expect(await readFile(path.join(live, 'contest-routes.conf'), 'utf8')).toContain('server_name routes.example.com;');
    expect(front.calls).toEqual(['test', 'reload']);
    // Nothing of the staging tree survives a successful apply.
    await expect(readdir(staging)).rejects.toThrow();
  });

  it('refuses a hostname that fails validation before anything reaches the filesystem', async () => {
    const { live, staging } = await workspace();
    await writeFile(path.join(live, 'contest-routes.conf'), PREVIOUS_ROUTES);
    const front = fakeFront();
    const unsafe: WiringPayload = {
      ...PAYLOAD,
      exposures: [{ ...PAYLOAD.exposures[0], hostname: 'bad host; rm -rf /' }],
    };

    const outcome = await applyExposureArtifacts(unsafe, {
      liveDir: live,
      stagingDir: staging,
      frontVhosts: [],
      front: front.runner,
    });

    expect(outcome).toMatchObject({ kind: 'refused', stage: 'validation' });
    expect(front.calls).toEqual([]);
    expect(await readFile(path.join(live, 'contest-routes.conf'), 'utf8')).toBe(PREVIOUS_ROUTES);
    await expect(readdir(staging)).rejects.toThrow();
  });

  it('leaves the previous include byte-identical and reloads nothing when nginx rejects the staged config', async () => {
    const { live, staging } = await workspace();
    await writeFile(path.join(live, 'contest-routes.conf'), PREVIOUS_ROUTES);
    const front = fakeFront({ failsAt: 'test' });

    const outcome = await applyExposureArtifacts(PAYLOAD, {
      liveDir: live,
      stagingDir: staging,
      frontVhosts: [],
      front: front.runner,
    });

    expect(outcome).toMatchObject({ kind: 'refused', stage: 'nginx-test' });
    expect((outcome as { error: string }).error).toContain('unknown directive');
    expect(await readFile(path.join(live, 'contest-routes.conf'), 'utf8')).toBe(PREVIOUS_ROUTES);
    expect(front.calls).toEqual(['test']);
    await expect(readdir(staging)).rejects.toThrow();
  });

  it('puts the previous include back when the reload itself fails', async () => {
    const { live, staging } = await workspace();
    await writeFile(path.join(live, 'contest-routes.conf'), PREVIOUS_ROUTES);
    const front = fakeFront({ failsAt: 'reload' });

    const outcome = await applyExposureArtifacts(PAYLOAD, {
      liveDir: live,
      stagingDir: staging,
      frontVhosts: [],
      front: front.runner,
    });

    expect(outcome).toMatchObject({ kind: 'refused', stage: 'reload' });
    expect(await readFile(path.join(live, 'contest-routes.conf'), 'utf8')).toBe(PREVIOUS_ROUTES);
  });

  it('reloads nothing when the save changed no byte', async () => {
    const { live, staging } = await workspace();
    const first = await applyExposureArtifacts(PAYLOAD, { liveDir: live, stagingDir: staging, frontVhosts: [], front: fakeFront().runner });
    expect(first).toMatchObject({ kind: 'applied' });

    const front = fakeFront();
    const outcome = await applyExposureArtifacts(PAYLOAD, { liveDir: live, stagingDir: staging, frontVhosts: [], front: front.runner });
    expect(outcome).toEqual({ kind: 'applied', changed: [] });
    expect(front.calls).toEqual([]);
  });

  it('removes a live serve config whose node the registry dropped', async () => {
    const { live, staging } = await workspace();
    await applyExposureArtifacts(PAYLOAD, { liveDir: live, stagingDir: staging, frontVhosts: [], front: fakeFront().runner });
    await mkdir(path.join(live, 'tailscale'), { recursive: true });
    await writeFile(path.join(live, 'tailscale', 'cms-1.json'), '{"stale":true}');

    const front = fakeFront();
    const outcome = await applyExposureArtifacts(PAYLOAD, { liveDir: live, stagingDir: staging, frontVhosts: [], front: front.runner });
    expect(outcome).toEqual({ kind: 'applied', changed: ['tailscale/cms-1.json'] });
    await expect(readFile(path.join(live, 'tailscale', 'cms-1.json'), 'utf8')).rejects.toThrow();
    expect(front.calls).toEqual(['test', 'reload']);
  });

  it('copies the certificate the caller names into the staged block', async () => {
    const { live, staging } = await workspace();
    const certificate = { certificate: '/etc/letsencrypt/live/cms.example.com/fullchain.pem', key: '/etc/letsencrypt/live/cms.example.com/privkey.pem' };
    const tls: WiringPayload = { ...PAYLOAD, exposures: [{ ...PAYLOAD.exposures[0], tls: true }] };
    let stagedBlock = '';
    const front = fakeFront({
      onTest: async (stagedDir) => {
        stagedBlock = await readFile(path.join(stagedDir, 'contest-routes.conf'), 'utf8');
      },
    });

    await applyExposureArtifacts(tls, { liveDir: live, stagingDir: staging, frontVhosts: [], front: front.runner, certificate });
    expect(stagedBlock).toContain('ssl_certificate /etc/letsencrypt/live/cms.example.com/fullchain.pem;');
  });
});
