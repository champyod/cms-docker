import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ repoRoot: '', audit: vi.fn() }));

vi.mock('@/lib/repo-root', () => ({ getRepoRoot: (): string => mocks.repoRoot }));
vi.mock('@/lib/permissions', () => ({ ensurePermission: vi.fn(async () => undefined) }));
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.audit }));
// Why present but unused: the shared readers import prisma at module load, and a mock that omits
// it fails the import before the action under test can be called.
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/i18n', () => ({ getDictionary: vi.fn(async () => ({ toasts: { discord: {} } })) }));

import { getDiscordNotificationSettings } from '@/app/actions/notifications';

const WEBHOOK_URL = 'https://discord.com/api/webhooks/1234567890123456/token';
const CONFIG_TOML_WITH_WEBHOOK = `[infra]\nDISCORD_WEBHOOK_URL = "${WEBHOOK_URL}"\n`;

let repoRoot = '';

/** A directory where a file is expected: readFile refuses it, which is what an unreadable read is. */
function makeUnreadable(file: string): void {
  fs.mkdirSync(path.join(repoRoot, file));
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-notification-settings-'));
  mocks.repoRoot = repoRoot;
  mocks.audit.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

/**
 * Why the case folds a readable .env against an unreadable one: the panel resolves the webhook
 * from config.toml alone, so a value that came back from .env — or a fault raised by trying to
 * open it — is the only way a second source could announce itself here.
 */
describe('discord notification settings resolve from config.toml alone', () => {
  it('reads the webhook from config.toml even when the generated .env cannot be read', async () => {
    fs.writeFileSync(path.join(repoRoot, 'config.toml'), CONFIG_TOML_WITH_WEBHOOK);
    makeUnreadable('.env');

    const result = await getDiscordNotificationSettings();

    expect(result).toMatchObject({
      success: true,
      configTomlPresent: true,
      configWebhookUrl: WEBHOOK_URL,
    });
  });

  it('reports an unreadable config.toml instead of an empty webhook', async () => {
    makeUnreadable('config.toml');
    fs.writeFileSync(path.join(repoRoot, '.env'), `DISCORD_WEBHOOK_URL=${WEBHOOK_URL}\n`);

    const result = await getDiscordNotificationSettings();

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected the config.toml read fault');
    expect(result.error).toContain('EISDIR');
    expect(result.error).toContain('config.toml');
  });

  it('keeps an absent config.toml an absent value rather than falling back to .env', async () => {
    fs.writeFileSync(path.join(repoRoot, '.env'), `DISCORD_WEBHOOK_URL=${WEBHOOK_URL}\n`);

    const result = await getDiscordNotificationSettings();

    expect(result).toMatchObject({
      success: true,
      configTomlPresent: false,
      configWebhookUrl: '',
    });
  });
});
