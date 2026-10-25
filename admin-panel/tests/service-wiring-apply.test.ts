import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { applyRegistryArtifacts } from '@/lib/service-wiring-apply';
import type { WiringPayload } from '@/lib/service-wiring-cli';
import { CONTEST_PROXY_CERTIFICATE } from '@/lib/service-wiring-render';

const roots: string[] = [];

async function outDir(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'cms-wiring-apply-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** One TLS exposure of its own hostname, one fragment on the front's vhost, one tailnet node. */
const PAYLOAD: WiringPayload = {
  services: [
    { id: 1, name: 'web-1', role: 'ContestWebServer', shard: 0, host: 'web-1', http_port: 8888, rpc_port: 21000, db_profile: 'default', contest_id: 7, enabled: true },
  ],
  wirings: [],
  exposures: [
    { service_id: 1, hostname: 'routes.example.com', path: '/', tls: true, tailnet: 'cms-7' },
  ],
};

const FRONT = ['primary|a.example.com|/ /admin|/=CONTEST_ROUTE_PATH /admin=ADMIN_ROUTE_PATH'];

describe('applyRegistryArtifacts', () => {
  it('writes the generated route files into the directory it is given and reports each as added', async () => {
    const dir = await outDir();
    const report = await applyRegistryArtifacts(PAYLOAD, { outDir: dir, frontVhosts: FRONT });

    expect(report.map((write) => [write.path, write.status])).toEqual([
      ['contest-routes.conf', 'added'],
      ['tailscale/cms-7.json', 'added'],
    ]);
    expect(await readFile(path.join(dir, 'contest-routes.conf'), 'utf8')).toContain('server_name routes.example.com;');
    expect(JSON.parse(await readFile(path.join(dir, 'tailscale/cms-7.json'), 'utf8'))).toHaveProperty('AllowFunnel');
  });

  it('reports an unchanged tree as unchanged and rewrites nothing', async () => {
    const dir = await outDir();
    await applyRegistryArtifacts(PAYLOAD, { outDir: dir, frontVhosts: FRONT });
    const report = await applyRegistryArtifacts(PAYLOAD, { outDir: dir, frontVhosts: FRONT });

    expect(report.every((write) => write.status === 'unchanged')).toBe(true);
    expect(report).toHaveLength(2);
  });

  it('reports only the file whose bytes changed as changed', async () => {
    const dir = await outDir();
    await applyRegistryArtifacts(PAYLOAD, { outDir: dir, frontVhosts: FRONT });
    // Dropping TLS changes the server block and nothing in the node's serve config.
    const plain: WiringPayload = {
      ...PAYLOAD,
      exposures: [{ ...PAYLOAD.exposures[0], tls: false }],
    };

    const report = await applyRegistryArtifacts(plain, { outDir: dir, frontVhosts: FRONT });
    expect(report.map((write) => [write.path, write.status])).toEqual([
      ['contest-routes.conf', 'changed'],
      ['tailscale/cms-7.json', 'unchanged'],
    ]);
    expect(await readFile(path.join(dir, 'contest-routes.conf'), 'utf8')).toContain('listen 80;');
  });

  it('writes the bytes the sync used to produce, newline included, so the output stays byte-identical', async () => {
    const dir = await outDir();
    const fragment: WiringPayload = {
      ...PAYLOAD,
      exposures: [{ service_id: 1, hostname: 'a.example.com', path: '/beta', tls: true, tailnet: null }],
    };
    await applyRegistryArtifacts(fragment, { outDir: dir, frontVhosts: FRONT });

    const routes = await readFile(path.join(dir, 'contest-routes.conf'), 'utf8');
    const location = await readFile(path.join(dir, 'locations-primary.conf'), 'utf8');
    expect(routes.endsWith('\n')).toBe(false);
    expect(location.endsWith('\n')).toBe(true);
    expect(location).toContain('location ^~ /beta/ {');
  });

  it('leaves the placeholder fragment in place when its vhost renders no location', async () => {
    const dir = await outDir();
    const placeholder = '# No registry exposure answers on this vhost.';
    await writeFile(path.join(dir, 'locations-primary.conf'), `${placeholder}\n`);

    const report = await applyRegistryArtifacts(PAYLOAD, { outDir: dir, frontVhosts: FRONT });
    expect(report.some((write) => write.path === 'locations-primary.conf')).toBe(false);
    expect(await readFile(path.join(dir, 'locations-primary.conf'), 'utf8')).toBe(`${placeholder}\n`);
  });

  it('removes a serve config for a node the registry no longer names', async () => {
    const dir = await outDir();
    await mkdir(path.join(dir, 'tailscale'), { recursive: true });
    await writeFile(path.join(dir, 'tailscale/cms-1.json'), '{}');

    const report = await applyRegistryArtifacts(PAYLOAD, { outDir: dir, frontVhosts: FRONT });
    expect(report).toContainEqual({ path: 'tailscale/cms-1.json', status: 'removed' });
    expect(await readdir(path.join(dir, 'tailscale'))).toEqual(['cms-7.json']);
  });

  it('writes nothing at all when the registry is refused', async () => {
    const dir = await outDir();
    const curated: WiringPayload = {
      ...PAYLOAD,
      exposures: [{ service_id: 1, hostname: 'a.example.com', path: '/admin', tls: true, tailnet: null }],
    };
    await expect(applyRegistryArtifacts(curated, { outDir: dir, frontVhosts: FRONT })).rejects.toThrow(/already serves/);
    expect(await readdir(dir)).toEqual([]);
  });

  it('honours the certificate the caller names, so the shell and the panel render the same block', async () => {
    const dir = await outDir();
    const certificate = { certificate: '/etc/letsencrypt/live/cms.example.com/fullchain.pem', key: '/etc/letsencrypt/live/cms.example.com/privkey.pem' };
    await applyRegistryArtifacts(PAYLOAD, { outDir: dir, frontVhosts: FRONT, certificate });
    expect(await readFile(path.join(dir, 'contest-routes.conf'), 'utf8')).toContain('ssl_certificate /etc/letsencrypt/live/cms.example.com/fullchain.pem;');
    expect(certificate).not.toEqual(CONTEST_PROXY_CERTIFICATE);
  });
});
