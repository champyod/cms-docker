import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  FAIL2BAN_JAIL_FILE,
  SECURITY_AGENT_ACTIONS,
  buildRenewRequest,
  buildUnbanRequest,
  isValidIpAddress,
  parseFail2banState,
  parseJailNames,
  serializeRequest,
  type UnbanRequestInput,
} from '@/lib/security/security-agent-protocol';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function unbanInput(overrides: Partial<UnbanRequestInput> = {}): UnbanRequestInput {
  return {
    id: 'req-12345678',
    jail: 'nginx-limit-req',
    ip: '203.0.113.7',
    requestedBy: 'ada',
    reason: 'operator confirmed a false positive',
    knownJails: ['nginx-http-auth', 'nginx-limit-req'],
    requestedAt: '2026-10-09T10:00:00.000Z',
    ...overrides,
  };
}

describe('parseJailNames', () => {
  it('reads the jails this deployment actually ships', () => {
    const content = fs.readFileSync(path.join(REPO_ROOT, FAIL2BAN_JAIL_FILE), 'utf-8');

    expect(parseJailNames(content)).toEqual(['nginx-http-auth', 'nginx-limit-req']);
  });

  it('ignores comments and indented keys', () => {
    const content = ['# a comment', '[jail-one]', 'enabled = true', '  [not-a-jail]'].join('\n');

    expect(parseJailNames(content)).toEqual(['jail-one']);
  });
});

describe('isValidIpAddress', () => {
  it('accepts v4 and v6 literals only', () => {
    expect(isValidIpAddress('203.0.113.7')).toBe(true);
    expect(isValidIpAddress('2001:db8::1')).toBe(true);
    expect(isValidIpAddress('203.0.113.7; rm -rf /')).toBe(false);
    expect(isValidIpAddress('localhost')).toBe(false);
    expect(isValidIpAddress('')).toBe(false);
  });
});

describe('buildUnbanRequest', () => {
  it('builds a request for a known jail and a valid address', () => {
    const result = buildUnbanRequest(unbanInput());

    expect(result.errors).toEqual([]);
    expect(result.request).toEqual({
      id: 'req-12345678',
      action: 'unban',
      jail: 'nginx-limit-req',
      ip: '203.0.113.7',
      requestedBy: 'ada',
      reason: 'operator confirmed a false positive',
      requestedAt: '2026-10-09T10:00:00.000Z',
    });
  });

  it('refuses an unknown jail even when its shape is valid', () => {
    const result = buildUnbanRequest(unbanInput({ jail: 'ssh' }));

    expect(result.request).toBeNull();
    expect(result.errors).toEqual(['Unknown jail: ssh']);
  });

  it('refuses an injection-shaped address, an empty reason and a short id', () => {
    const result = buildUnbanRequest(unbanInput({ ip: '1.2.3.4\n--force', reason: '  ', id: 'abc' }));

    expect(result.request).toBeNull();
    expect(result.errors).toHaveLength(3);
  });
});

describe('buildRenewRequest', () => {
  it('carries no jail or address', () => {
    const result = buildRenewRequest({ id: 'req-abcdefgh', requestedBy: 'ada', reason: 'expiry near', requestedAt: '2026-10-09T10:00:00.000Z' });

    expect(result.errors).toEqual([]);
    expect(result.request?.action).toBe('renew-certs');
    expect(result.request?.jail).toBeNull();
    expect(result.request?.ip).toBeNull();
  });

  it('requires a reason', () => {
    expect(buildRenewRequest({ id: 'req-abcdefgh', requestedBy: 'ada', reason: '', requestedAt: 'x' }).errors).toEqual([
      'A reason is required to renew certificates',
    ]);
  });
});

describe('parseFail2banState', () => {
  it('reads bans and keeps an unknown agent state distinct from an empty one', () => {
    const raw = JSON.stringify({
      updatedAt: '2026-10-09T10:00:00Z',
      bans: [
        { jail: 'nginx-http-auth', ip: '203.0.113.7', bannedAt: null, expiresAt: null },
        { jail: 'nginx-limit-req', ip: 'not-an-ip' },
      ],
    });

    expect(parseFail2banState(raw)).toEqual({
      updatedAt: '2026-10-09T10:00:00Z',
      bans: [{ jail: 'nginx-http-auth', ip: '203.0.113.7', bannedAt: null, expiresAt: null }],
    });
    expect(parseFail2banState(null)).toBeNull();
    expect(parseFail2banState('not json')).toBeNull();
    expect(parseFail2banState('{"bans": []}')).toEqual({ updatedAt: null, bans: [] });
  });
});

describe('serializeRequest', () => {
  it('writes exactly what the agent reads back', () => {
    const request = buildUnbanRequest(unbanInput()).request;
    expect(request).not.toBeNull();

    expect(JSON.parse(serializeRequest(request!))).toEqual(request);
    expect(SECURITY_AGENT_ACTIONS).toContain(request!.action);
  });
});
