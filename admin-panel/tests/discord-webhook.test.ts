import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  buildDiscordAlertPayload,
  postDiscordPayload,
  readTomlValue,
  upsertTomlValue,
  validateDiscordRoleId,
  validateDiscordWebhookUrl,
  validateNotificationEnvUpdates,
} from '@/lib/discord-webhook';

const WEBHOOK_URL = `https://discord.com/api/webhooks/${'1'.repeat(18)}/${'a'.repeat(24)}`;

interface StubRequest {
  method: string;
  url: string;
  contentType: string;
  body: string;
}

interface Stub {
  url: string;
  requests: StubRequest[];
  close: () => Promise<void>;
}

async function startStub(status: number, responseBody: string): Promise<Stub> {
  const requests: StubRequest[] = [];
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += String(chunk);
    });
    req.on('end', () => {
      requests.push({
        method: req.method ?? '',
        url: req.url ?? '',
        contentType: String(req.headers['content-type'] ?? ''),
        body,
      });
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(responseBody);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/api/webhooks/stub`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Port 1 on loopback is never listening — stands in for an unroutable endpoint. */
const UNREACHABLE_URL = 'http://127.0.0.1:1/api/webhooks/unreachable';

describe('discord webhook URL validation', () => {
  it('accepts a discord.com webhook URL and normalises surrounding whitespace', () => {
    expect(validateDiscordWebhookUrl(`  ${WEBHOOK_URL}  `)).toEqual({ ok: true, value: WEBHOOK_URL });
  });

  it('accepts an empty value so alerting can be switched off deliberately', () => {
    expect(validateDiscordWebhookUrl('')).toEqual({ ok: true, value: '' });
  });

  it.each([
    ['plain http', WEBHOOK_URL.replace('https://', 'http://')],
    ['wrong host', 'https://example.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuv'],
    ['host that merely ends in discord.com', 'https://notdiscord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuv'],
    ['missing token', `https://discord.com/api/webhooks/${'1'.repeat(18)}/`],
    ['not a url at all', 'yes please'],
  ])('rejects %s', (_label, value) => {
    const result = validateDiscordWebhookUrl(value);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it('accepts snowflake role ids and rejects non-numeric ones', () => {
    expect(validateDiscordRoleId('123456789012345678')).toEqual({ ok: true, value: '123456789012345678' });
    expect(validateDiscordRoleId('').ok).toBe(true);
    expect(validateDiscordRoleId('@everyone').ok).toBe(false);
  });
});

describe('test alert request and response handling', () => {
  const stubs: Stub[] = [];

  afterEach(async () => {
    while (stubs.length > 0) {
      const stub = stubs.pop();
      if (stub) await stub.close();
    }
  });

  it('posts the monitor payload shape and reports the HTTP success', async () => {
    const stub = await startStub(204, '');
    stubs.push(stub);

    const payload = buildDiscordAlertPayload({
      title: 'CMS Alert Test',
      description: 'delivery check',
      roleId: '123456789012345678',
      footerText: 'CMS Admin Panel',
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    const result = await postDiscordPayload(stub.url, payload);

    expect(result).toEqual({ success: true, status: 204 });
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0].method).toBe('POST');
    expect(stub.requests[0].contentType).toBe('application/json');

    const sent = JSON.parse(stub.requests[0].body) as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(['content', 'embeds']);
    expect(sent.content).toBe('<@&123456789012345678>');
    const embed = (sent.embeds as Array<Record<string, unknown>>)[0];
    expect(Object.keys(embed).sort()).toEqual(['color', 'description', 'footer', 'timestamp', 'title']);
    expect(embed.color).toBe(3447003);
    expect(embed.timestamp).toBe('2026-01-01T00:00:00.000Z');
    expect(embed.footer).toEqual({ text: 'CMS Admin Panel' });
  });

  it('omits the mention when no role id is set', () => {
    const payload = buildDiscordAlertPayload({
      title: 'CMS Alert Test',
      description: 'delivery check',
      footerText: 'CMS Admin Panel',
    });
    expect(payload.content).toBeUndefined();
  });

  it('surfaces the Discord HTTP failure with its status and reason', async () => {
    const stub = await startStub(401, '{"message": "401: Unauthorized", "code": 50027}');
    stubs.push(stub);

    const result = await postDiscordPayload(stub.url, buildDiscordAlertPayload({
      title: 'CMS Alert Test',
      description: 'delivery check',
      footerText: 'CMS Admin Panel',
    }));

    expect(result.success).toBe(false);
    expect(result.status).toBe(401);
    expect(result.error).toContain('HTTP 401');
    expect(result.error).toContain('401: Unauthorized');
  });

  it('surfaces an unreachable endpoint as a failure instead of throwing', async () => {
    const result = await postDiscordPayload(UNREACHABLE_URL, buildDiscordAlertPayload({
      title: 'CMS Alert Test',
      description: 'delivery check',
      footerText: 'CMS Admin Panel',
    }));

    expect(result.success).toBe(false);
    expect(result.status).toBe(0);
    expect(result.error).toMatch(/Could not reach/);
  });
});

describe('config.toml writes', () => {
  const TOML = [
    '# config.toml — single source of truth',
    '[core]',
    'CMS_DOMAIN = "cms.local"',
    'POSTGRES_DB = "cmsdb"',
    '',
    '[infra]',
    'DISCORD_WEBHOOK_URL = ""        # url; optional',
    'DISCORD_ROLE_ID = ""            # str',
    'MONITOR_INTERVAL = 10',
    '',
    '[rpc]',
    'RPC_SECRET = "keep-me"',
    '',
  ].join('\n');

  it('replaces a key inside its own section only', () => {
    const updated = upsertTomlValue(TOML, 'infra', 'DISCORD_WEBHOOK_URL', WEBHOOK_URL);
    expect(readTomlValue(updated, 'infra', 'DISCORD_WEBHOOK_URL')).toBe(WEBHOOK_URL);
    expect(readTomlValue(updated, 'infra', 'MONITOR_INTERVAL')).toBe('10');
    expect(readTomlValue(updated, 'rpc', 'RPC_SECRET')).toBe('keep-me');
    expect(updated).toContain('DISCORD_ROLE_ID');
  });

  it('clears a value when the webhook is removed', () => {
    const withUrl = upsertTomlValue(TOML, 'infra', 'DISCORD_WEBHOOK_URL', WEBHOOK_URL);
    const cleared = upsertTomlValue(withUrl, 'infra', 'DISCORD_WEBHOOK_URL', '');
    expect(readTomlValue(cleared, 'infra', 'DISCORD_WEBHOOK_URL')).toBe('');
  });

  it('inserts the key when the section exists but the key does not', () => {
    const updated = upsertTomlValue(TOML, 'infra', 'DISCORD_ROLE_ID_SETTING', '9'.repeat(18));
    expect(readTomlValue(updated, 'infra', 'DISCORD_ROLE_ID_SETTING')).toBe('9'.repeat(18));
    expect(updated.indexOf('DISCORD_ROLE_ID_SETTING')).toBeLessThan(updated.indexOf('[rpc]'));
  });

  it('appends the section when it is missing entirely', () => {
    const updated = upsertTomlValue('[core]\nCMS_DOMAIN = "cms.local"\n', 'infra', 'DISCORD_ROLE_ID', '5'.repeat(18));
    expect(readTomlValue(updated, 'infra', 'DISCORD_ROLE_ID')).toBe('5'.repeat(18));
    expect(readTomlValue(updated, 'core', 'CMS_DOMAIN')).toBe('cms.local');
  });
});
