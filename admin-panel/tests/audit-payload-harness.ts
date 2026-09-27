import { expect, vi } from 'vitest';

/**
 * Shared harness for the audit-payload tests: it loads the audited action modules with every
 * secret they can reach replaced by a canary, and with the audit writer captured instead of the
 * database. The canaries are what the leak assertions look for, so a row that grows a value field
 * starts failing on the string it grew.
 */

export const ENV_SECRET = 'canary-env-secret-9f3a';
export const TOML_SECRET = 'canary-toml-secret-7b2c';
export const WEBHOOK_TOKEN = 'canary-webhook-secret-4d1e';
export const WEBHOOK_URL = `https://discord.com/api/webhooks/1234567890123456/${WEBHOOK_TOKEN}`;
export const LOG_SECRET = 'canary-log-token-5a6b';
export const PASSWORD_SECRET = 'canary-password-1c2d';
export const WORKER_HOST = 'canary-worker.internal';

const ENV_CONTENT = [
  '# comment line',
  `DISCORD_WEBHOOK_URL=${WEBHOOK_URL}`,
  `POSTGRES_PASSWORD=${ENV_SECRET}`,
  '',
].join('\n');

const TOML_CONTENT = [
  '[core]',
  `POSTGRES_PASSWORD = "${TOML_SECRET}"`,
  '[admin]',
  'DEPLOYMENT_TYPE = "img"',
  '',
].join('\n');

const CMS_TOML_CONTENT = [
  '[Worker]',
  'Worker = [',
  `    ["${WORKER_HOST}", 9000],`,
  ']',
  '',
].join('\n');

/** Every payload key a read row may carry: names, ids, counts, flags, states and error names. */
const ALLOWED_PAYLOAD_KEYS = new Set([
  'adminId', 'containerId', 'containerIds', 'contestId', 'count', 'delivered', 'error',
  'file', 'filename', 'hasRoleId', 'kind', 'operationId', 'requestedKeys', 'resolved',
  'running', 'status', 'tail', 'total', 'userId', 'usedConfiguredWebhook',
]);

const SECRETS = [ENV_SECRET, TOML_SECRET, WEBHOOK_TOKEN, WEBHOOK_URL, LOG_SECRET, PASSWORD_SECRET, WORKER_HOST];

export interface AuditCall {
  verb: string;
  entity: string;
  entityId?: string;
  beforeValues?: unknown;
  afterValues?: unknown;
  result: string;
}

export interface AuditHarness {
  entries: AuditCall[];
  users: { findUnique: ReturnType<typeof vi.fn> };
  admins: { findUnique: ReturnType<typeof vi.fn> };
}

function readContentFor(filePath: string): string {
  if (filePath.endsWith('cms.toml')) return CMS_TOML_CONTENT;
  if (filePath.endsWith('.env')) return ENV_CONTENT;
  return TOML_CONTENT;
}

export async function loadAuditedActions(options?: { userRow?: unknown; adminRow?: unknown }): Promise<AuditHarness> {
  const entries: AuditCall[] = [];
  // Why the `in` check and not `??`: a test passing null is asking for a row that is not there,
  // and `null ?? default` would hand it the default row instead.
  const userRow = options && 'userRow' in options ? options.userRow : { password: PASSWORD_SECRET };
  const adminRow = options && 'adminRow' in options ? options.adminRow : { authentication: PASSWORD_SECRET };
  const users = { findUnique: vi.fn(async () => userRow) };
  const admins = { findUnique: vi.fn(async () => adminRow) };

  vi.doMock('@/lib/audit', () => ({
    recordAudit: vi.fn(async (entry: AuditCall) => { entries.push(entry); }),
  }));
  vi.doMock('@/lib/permissions', async () => {
    const actual = await vi.importActual<typeof import('@/lib/permissions')>('@/lib/permissions');
    return { ...actual, ensurePermission: vi.fn(async () => {}), getPermissions: vi.fn(async () => new Set<string>()) };
  });
  vi.doMock('@/lib/auth', () => ({
    getSession: vi.fn(async () => ({ userId: '1', username: 'tester', expiresAt: new Date().toISOString() })),
  }));
  vi.doMock('@/lib/repo-root', () => ({ getRepoRoot: vi.fn(() => '/repo') }));
  vi.doMock('fs/promises', () => ({
    default: {
      readFile: vi.fn(async (filePath: string) => readContentFor(filePath)),
      access: vi.fn(async () => {}),
      writeFile: vi.fn(async () => {}),
    },
  }));
  vi.doMock('child_process', () => ({
    exec: (_command: string, callback: (error: null, result: { stdout: string; stderr: string }) => void): void => {
      callback(null, { stdout: `LOGSTREAM ${LOG_SECRET}`, stderr: '' });
    },
  }));
  vi.doMock('@/lib/container-restart-store', () => ({
    containerRestartConfigPath: vi.fn(() => '/repo/restart-config.json'),
    readContainerRestartConfig: vi.fn(async () => ({ abc123: { autoRestart: true, maxRestarts: 5, currentRestarts: 0 } })),
  }));
  vi.doMock('@/lib/deploy-operations', () => ({
    getActiveDeployOperation: vi.fn(async () => ({ operationId: 'op-1', contestId: 7, startedAt: 'now', percent: 10 })),
    runDeployContest: vi.fn(),
    reconcileDeployOperations: vi.fn(async () => {}),
  }));
  vi.doMock('@/lib/deployment-mode-file', () => ({
    readDeploymentModeSetting: vi.fn(async () => ({ mode: 'img', resolved: true })),
  }));
  vi.doMock('@/lib/discord-webhook', async () => {
    const actual = await vi.importActual<typeof import('@/lib/discord-webhook')>('@/lib/discord-webhook');
    return { ...actual, postDiscordPayload: vi.fn(async () => ({ success: true, status: 204 })) };
  });
  vi.doMock('@/i18n', () => ({
    getDictionary: vi.fn(async () => ({
      toasts: { discord: { noWebhookUrl: 'no webhook', testAlertTitle: 't', testAlertDescription: 'd', deliveryFailed: 'failed' } },
    })),
  }));
  vi.doMock('@/lib/prisma', () => ({ prisma: { users, admins } }));

  return { entries, users, admins };
}

/** Fails if any row carries a key outside the allowlist, or any canary anywhere in its values. */
export function expectNoLeak(entries: AuditCall[]): void {
  for (const entry of entries) {
    for (const payload of [entry.beforeValues, entry.afterValues]) {
      if (payload === undefined || payload === null || typeof payload !== 'object') continue;
      for (const key of Object.keys(payload as Record<string, unknown>)) {
        expect(ALLOWED_PAYLOAD_KEYS.has(key), `unexpected payload key "${key}" on ${entry.verb}`).toBe(true);
      }
    }
  }
  const serialised = JSON.stringify(entries);
  for (const secret of SECRETS) {
    expect(serialised, `audit rows leaked ${secret}`).not.toContain(secret);
  }
}

/** Runs one read, asserts it wrote exactly one leak-free row, and hands back the verb. */
export async function verbOfSingleRow(run: () => Promise<unknown>, entries: AuditCall[]): Promise<string> {
  await run();
  expect(entries).toHaveLength(1);
  expectNoLeak(entries);
  return entries[0].verb;
}
