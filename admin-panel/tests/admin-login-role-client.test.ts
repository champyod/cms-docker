import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The credential read owns a connection, and only that connection.
 *
 * WHY these assertions exist: moving `admins.authentication` off the application-wide connection is
 * the point of the role, but the move is one import away from being undone — a later edit that
 * reaches for `prisma` reads the hash happily (that role still has the grant) and no test that only
 * exercises responses would notice. So the connection itself is pinned: absent variable fails
 * loudly, present variable yields one cached client built over it, and the login source selects the
 * four admitted columns over that client and nothing else.
 *
 * WHY Prisma is mocked and not connected: constructing a `PrismaClient` opens no socket, but the
 * suite has no database and must not acquire one. The mock records each construction so "no client
 * was created" is an assertion about behaviour, not about intent.
 */

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

/**
 * Loads a fresh `@/lib/prisma` over a fake `@prisma/client`.
 *
 * WHY `vi.resetModules()` and a deleted `global.prisma`: the module caches its wrapper on
 * `globalThis` outside production, so without both the next case would inherit the previous case's
 * client and the construction counts below would prove nothing.
 */
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
    // WHY a source assertion: the failure mode is a fallback written months from now. Naming either
    // token in this module is how it would start. The word boundaries matter: the role's own
    // variable ends in DATABASE_URL and must not be mistaken for the application one.
    expect(AUTH_SOURCE).not.toMatch(/\bDATABASE_URL\b/);
    expect(AUTH_SOURCE).not.toMatch(/cmsuser/i);
    expect(AUTH_SOURCE).toMatch(/import \{[^}]*getAdminLoginClient[^}]*\} from '@\/lib\/prisma'/);
  });

  it('leaves the last_login_at write on the application connection', () => {
    // The role holds SELECT on three columns, so an UPDATE through it would fail; the write must
    // stay where the grant exists.
    const body = functionSource('completeLogin');

    expect(body).toContain('prisma.admins.update');
    expect(body).not.toContain('getAdminLoginClient');
  });
});
