import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Pin the connection, not just the response: a later edit reaching for prisma would read the hash unnoticed.

const ENV = 'ADMIN_LOGIN_DATABASE_URL';
const ROLE_URL = 'postgresql://cms_admin_login@database:5432/cmsdb';
const PANEL_ROOT = path.resolve(__dirname, '..');
const AUTH_SOURCE = fs.readFileSync(path.join(PANEL_ROOT, 'src', 'app', 'actions', 'auth.ts'), 'utf8');

interface ConstructedClient {
  readonly options?: { readonly datasourceUrl?: string };
}

type FakePrismaClient = new (options?: { readonly datasourceUrl?: string }) => {
  readonly admins: {
    findMany: () => Promise<unknown[]>;
    findUnique: () => Promise<unknown>;
  };
};

interface LoadedModule {
  readonly getAdminLoginClient: typeof import('@/lib/prisma').getAdminLoginClient;
  readonly PrismaClient: FakePrismaClient;
}

// Fresh module per case: the wrapper is cached on globalThis outside production.
async function loadPrismaModule(constructed: ConstructedClient[]): Promise<LoadedModule> {
  vi.resetModules();
  delete (globalThis as { prisma?: unknown }).prisma;

  class RecordingPrismaClient {
    readonly admins = {
      findMany: async (): Promise<unknown[]> => [],
      findUnique: async (): Promise<unknown> => null,
    };

    constructor(options?: { readonly datasourceUrl?: string }) {
      constructed.push({ options });
    }
  }

  vi.doMock('@prisma/client', () => ({ PrismaClient: RecordingPrismaClient }));
  const loaded = await import('@/lib/prisma');
  return { getAdminLoginClient: loaded.getAdminLoginClient, PrismaClient: RecordingPrismaClient };
}

/** The source of a top-level function in auth.ts, from its signature to its closing brace. */
function functionSource(name: string): string {
  const start = AUTH_SOURCE.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`auth.ts declares no ${name}()`);
  const end = AUTH_SOURCE.indexOf('\n}', start);
  if (end < 0) throw new Error(`auth.ts ${name}() has no closing brace at column 0`);
  return AUTH_SOURCE.slice(start, end + 2);
}

/** The column names a `select: { … }` block names, in written order. */
function selectedColumns(body: string): string[] {
  const block = body.match(/select:\s*\{([^}]*)\}/);
  if (block === null) throw new Error('the credential read passes no select block');
  return [...block[1].matchAll(/(\w+):\s*true/g)].map((match) => match[1]);
}

const savedRoleUrl = process.env[ENV];

beforeEach(() => {
  delete process.env[ENV];
});

afterEach(() => {
  vi.doUnmock('@prisma/client');
  vi.unstubAllEnvs();
  if (savedRoleUrl === undefined) delete process.env[ENV];
  else process.env[ENV] = savedRoleUrl;
});

describe('the admin credential client', () => {
  it('raises a named error and creates nothing when ADMIN_LOGIN_DATABASE_URL is absent', async () => {
    // The application connection is present and valid; it must still not be borrowed.
    vi.stubEnv('DATABASE_URL', 'postgresql://cmsuser:***@database:5432/cmsdb');
    const constructed: ConstructedClient[] = [];
    const { getAdminLoginClient } = await loadPrismaModule(constructed);
    const moduleLevelClients = constructed.length;

    expect(() => getAdminLoginClient()).toThrowError(/ADMIN_LOGIN_DATABASE_URL/);
    expect(() => getAdminLoginClient()).toThrowError(/cms_admin_login role is not provisioned/);
    // Repeating the call re-raises: a failure is not cached into a usable client.
    expect(() => getAdminLoginClient()).toThrowError(/ADMIN_LOGIN_DATABASE_URL/);
    expect(constructed).toHaveLength(moduleLevelClients);
  });

  it('builds one usable, cached client over the role URL once the variable is set', async () => {
    process.env[ENV] = ROLE_URL;
    const constructed: ConstructedClient[] = [];
    const { getAdminLoginClient, PrismaClient } = await loadPrismaModule(constructed);
    const moduleLevelClients = constructed.length;

    const client = getAdminLoginClient();

    expect(client).toBeInstanceOf(PrismaClient);
    expect(typeof client.admins.findUnique).toBe('function');
    expect(getAdminLoginClient()).toBe(client);
    expect(constructed).toHaveLength(moduleLevelClients + 1);
    expect(constructed[moduleLevelClients].options?.datasourceUrl).toBe(ROLE_URL);
  });
});

describe('the login lookup', () => {
  it('reads the four admitted columns over the role client', () => {
    const body = functionSource('findActiveAdmin');

    expect(body).toContain('getAdminLoginClient()');
    expect(body).not.toContain('prisma.admins');
    expect(selectedColumns(body)).toEqual(['id', 'username', 'authentication', 'enabled']);
    // The identity the database admits for a pre-session read is not optional.
    expect(body).toContain('SYSTEM_IDENTITIES.AUTH');
    expect(body).toContain('withActor(');
  });

  it('never names the application connection or its role', () => {
    // Source assertion: the failure mode is a fallback written later, and naming the token is how it starts.
    expect(AUTH_SOURCE).not.toMatch(/\bDATABASE_URL\b/);
    expect(AUTH_SOURCE).not.toMatch(/cmsuser/i);
    expect(AUTH_SOURCE).toMatch(/import \{[^}]*getAdminLoginClient[^}]*\} from '@\/lib\/prisma'/);
  });

  it('leaves the last_login_at write on the application connection', () => {
    // The role's grant covers SELECT only, so the write must stay on the application connection.
    const body = functionSource('completeLogin');

    expect(body).toContain('prisma.admins.update');
    expect(body).not.toContain('getAdminLoginClient');
  });
});
