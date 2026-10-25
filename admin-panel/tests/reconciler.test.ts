import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { reconcileOnce, runReconciler, type ReconcileDeps } from '@/lib/reconciler';
import type { FrontRunner } from '@/lib/exposure-apply';
import type { WiringPayload } from '@/lib/service-wiring-cli';

const roots: string[] = [];

async function workspace(): Promise<{ live: string; staging: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'cms-reconciler-'));
  roots.push(root);
  const live = path.join(root, 'generated');
  await mkdir(live, { recursive: true });
  return { live, staging: path.join(live, '.staging') };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const SERVICE = {
  id: 1, name: 'web-1', role: 'ContestWebServer', shard: 0, host: 'web-1',
  http_port: 8888, rpc_port: 21000, db_profile: 'default', contest_id: 7, enabled: true,
};

function payload(exposures: WiringPayload['exposures']): WiringPayload {
  return { services: [SERVICE], wirings: [], exposures };
}

const GOOD = { service_id: 1, hostname: 'routes.example.com', path: '/', tls: false, tailnet: null } as const;

interface CountingFront {
  readonly runner: FrontRunner;
  readonly calls: string[];
}

function countingFront(): CountingFront {
  const calls: string[] = [];
  return {
    calls,
    runner: {
      testStagedConfig: async (): Promise<string> => { calls.push('test'); return 'ok'; },
      reloadFront: async (): Promise<string> => { calls.push('reload'); return ''; },
    },
  };
}

function depsFor(live: string, staging: string, body: WiringPayload, front: CountingFront, logs: string[] = []): ReconcileDeps {
  return {
    liveDir: live,
    stagingDir: staging,
    readPayload: async () => body,
    readFrontVhosts: async () => [],
    front: front.runner,
    log: (line) => logs.push(line),
  };
}

describe('reconcileOnce', () => {
  it('reloads nothing on a tree that already matches, and counts it', async () => {
    const { live, staging } = await workspace();
    const first = countingFront();
    await reconcileOnce(depsFor(live, staging, payload([GOOD]), first));
    expect(first.calls).toEqual(['test', 'reload']);

    const second = countingFront();
    const result = await reconcileOnce(depsFor(live, staging, payload([GOOD]), second));
    expect(result).toMatchObject({ reloaded: false, changed: [] });
    expect(second.calls).toEqual([]);
  });

  it('reloads once when a row written outside the panel changes the rendered set', async () => {
    const { live, staging } = await workspace();
    await reconcileOnce(depsFor(live, staging, payload([GOOD]), countingFront()));

    const next = countingFront();
    const result = await reconcileOnce(depsFor(live, staging, payload([GOOD, { ...GOOD, path: '/beta' }]), next));
    expect(result.reloaded).toBe(true);
    expect(result.changed).toEqual(['contest-routes.conf']);
    expect(next.calls).toEqual(['test', 'reload']);
    expect(await readFile(path.join(live, 'contest-routes.conf'), 'utf8')).toContain('location ^~ /beta/ {');
  });

  it('skips a row the renderer cannot parse, logs one line, and still applies the healthy rows', async () => {
    const { live, staging } = await workspace();
    const logs: string[] = [];
    const front = countingFront();
    const bad = { ...GOOD, hostname: 'bad host' };

    const result = await reconcileOnce(depsFor(live, staging, payload([GOOD, bad]), front, logs));

    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain('unsafe hostname');
    expect(logs.filter((line) => line.includes('skipping'))).toHaveLength(1);
    expect(front.calls).toEqual(['test', 'reload']);
    const routes = await readFile(path.join(live, 'contest-routes.conf'), 'utf8');
    expect(routes).toContain('server_name routes.example.com;');
    expect(routes).not.toContain('bad host');
  });

  it('writes nothing when the database cannot be read', async () => {
    const { live, staging } = await workspace();
    const front = countingFront();
    const deps: ReconcileDeps = {
      ...depsFor(live, staging, payload([GOOD]), front),
      readPayload: async () => { throw new Error('database is unreachable'); },
    };

    await expect(reconcileOnce(deps)).rejects.toThrow(/unreachable/);
    expect(await readdir(live)).toEqual([]);
    expect(front.calls).toEqual([]);
  });
});

describe('runReconciler', () => {
  it('survives a failing tick and keeps reconciling', async () => {
    const ticks: number[] = [];
    let attempts = 0;
    const controller = new AbortController();
    const logs: string[] = [];

    await runReconciler({
      signal: controller.signal,
      log: (line) => logs.push(line),
      waitFor: async () => { if (attempts >= 3) controller.abort(); },
      once: async () => {
        attempts += 1;
        ticks.push(attempts);
        if (attempts === 1) throw new Error('database is unreachable');
        return { reloaded: false, changed: [], skipped: [] };
      },
    });

    expect(ticks).toEqual([1, 2, 3]);
    expect(logs.some((line) => line.includes('database is unreachable'))).toBe(true);
    expect(logs.some((line) => line.includes('keeping the front'))).toBe(true);
  });
});
