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
 * Why the fault is asserted apart from the absent case: a settings screen with nothing configured
 * and one whose configuration could not be opened look identical once the read error is folded
 * into an empty value, and only the second is a fault the operator has to fix.
 */
describe('discord notification settings with an unreadable configuration', () => {
  it('reports an unreadable config.toml instead of an empty webhook', async () => {
    makeUnreadable('config.toml');
    fs.writeFileSync(path.join(repoRoot, '.env'), `DISCORD_WEBHOOK_URL=${WEBHOOK_URL}\n`);

    const result = await getDiscordNotificationSettings();

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected the config.toml read fault');
    expect(result.error).toContain('EISDIR');
    expect(result.error).toContain('config.toml');
  });

  it('reports an unreadable .env instead of an empty effective webhook', async () => {
    fs.writeFileSync(path.join(repoRoot, 'config.toml'), CONFIG_TOML_WITH_WEBHOOK);
    makeUnreadable('.env');

    const result = await getDiscordNotificationSettings();

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected the .env read fault');
    expect(result.error).toContain('EISDIR');
    expect(result.error).toContain('.env');
  });

  it('keeps an absent config.toml an absent value beside the .env the monitor reads', async () => {
    fs.writeFileSync(path.join(repoRoot, '.env'), `DISCORD_WEBHOOK_URL=${WEBHOOK_URL}\n`);

    const result = await getDiscordNotificationSettings();

    expect(result).toMatchObject({
      success: true,
      configTomlPresent: false,
      configWebhookUrl: '',
      effectiveWebhookUrl: WEBHOOK_URL,
    });
  });
});
