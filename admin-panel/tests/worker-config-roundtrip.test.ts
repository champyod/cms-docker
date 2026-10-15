import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ repoRoot: '', audit: vi.fn() }));

vi.mock('@/lib/repo-root', () => ({ getRepoRoot: (): string => mocks.repoRoot }));
vi.mock('@/lib/permissions', () => ({ ensurePermission: vi.fn(async () => undefined) }));
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.audit }));
// Why present but unused: the shared reader imports prisma at module load, and a mock that
// omits it fails the import before either action under test can be called.
vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import { getWorkers, updateWorkers } from '@/app/actions/workerConfig';
import { loadConfiguredWorkers } from '@/lib/worker-stats';

const CONFIG_WITH_STALE_FLEET = [
  '[core]',
  'POSTGRES_PASSWORD = "secret"',
  '[worker]',
  'WORKER_SHARD = 0',
  'WORKER_5 = "10.0.0.9:26009"',
  '',
].join('\n');

const GENERATED_CMS_TOML = '[EvaluationService = [["cms-evaluation-service", 25000]]]\nWorker = [\n    ["stale.example", 1],\n]\n';

const SAVED_FLEET = [
  { host: '10.0.0.1', port: 26001 },
  { host: '10.0.0.2', port: 26002 },
];

let repoRoot = '';

/** The host's repo layout: config.toml beside the config/ directory the sync generates into. */
function seedRepo(): void {
  fs.writeFileSync(path.join(repoRoot, 'config.toml'), CONFIG_WITH_STALE_FLEET);
  fs.mkdirSync(path.join(repoRoot, 'config'));
  fs.writeFileSync(path.join(repoRoot, 'config', 'cms.toml'), GENERATED_CMS_TOML);
}

function readConfigToml(): string {
  return fs.readFileSync(path.join(repoRoot, 'config.toml'), 'utf-8');
}

function readGeneratedCmsToml(): string {
  return fs.readFileSync(path.join(repoRoot, 'config', 'cms.toml'), 'utf-8');
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-worker-config-'));
  mocks.repoRoot = repoRoot;
  mocks.audit.mockReset();
  seedRepo();
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

/**
 * Why the round trip is the whole assertion: the operator's edit is only real if the read that
 * follows it returns the same endpoints, and the deployment only sees it if the written file is
 * the one the sync renders .env from. A writer aimed at the generated cms.toml passed neither.
 */
describe('worker configuration round trip', () => {
  it('reads back through the shared reader exactly what it wrote', async () => {
    const saved = await updateWorkers(SAVED_FLEET);
    expect(saved.success).toBe(true);

    const written = readConfigToml();
    expect(written).toContain('WORKER_0 = "10.0.0.1:26001"');
    expect(written).toContain('WORKER_1 = "10.0.0.2:26002"');
    expect(written).not.toContain('WORKER_5');
    expect(written).toContain('WORKER_SHARD = 0');

    const shown = await getWorkers();
    expect(shown.workers).toEqual(SAVED_FLEET);

    const fleet = await loadConfiguredWorkers(repoRoot);
    expect(fleet.workers.map(({ host, port }) => `${host}:${port}`)).toEqual([
      '10.0.0.1:26001',
      '10.0.0.2:26002',
    ]);
  });

  it('leaves the generated cms.toml to the sync that owns it', async () => {
    await updateWorkers(SAVED_FLEET);

    expect(readGeneratedCmsToml()).toBe(GENERATED_CMS_TOML);
  });

  it('removes the worker the operator dropped instead of leaving the row behind', async () => {
    const saved = await updateWorkers([]);
    expect(saved.success).toBe(true);

    expect(readConfigToml()).not.toContain('WORKER_5');
    expect((await loadConfiguredWorkers(repoRoot)).workers).toEqual([]);
  });
});
