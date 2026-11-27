import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Pin the connection: the application role still holds the whole table, so listing through it would go unnoticed.

const ENV = 'ADMIN_READ_DATABASE_URL';
const ROLE_URL = 'postgresql://cms_admin_read_people@database:5432/cmsdb';
const PANEL_ROOT = path.resolve(__dirname, '..');
const ADMINS_SOURCE = fs.readFileSync(path.join(PANEL_ROOT, 'src', 'app', 'actions', 'admins.ts'), 'utf8');
const SELECTS_SOURCE = fs.readFileSync(path.join(PANEL_ROOT, 'src', 'lib', 'prisma-selects.ts'), 'utf8');
const ROLES_MIGRATION = fs.readFileSync(
  path.join(PANEL_ROOT, 'prisma', 'sql', '20260820110000_generated_roles.sql'),
  'utf8',
);

/** The grant this lane is wired to: the role's SELECT list on `public.admins`. */
const GRANTED_COLUMNS = ['id', 'username', 'name', 'enabled', 'last_login_at'];

interface ConstructedClient {
  readonly options?: { readonly datasourceUrl?: string };
}

type FakePrismaClient = new (options?: { readonly datasourceUrl?: string }) => {
  readonly admins: { findMany: () => Promise<unknown[]> };
};

interface LoadedModule {
  readonly getAdminReadClient: typeof import('@/lib/prisma').getAdminReadClient;
  readonly PrismaClient: FakePrismaClient;
}

// Fresh module per case: the wrapper is cached on globalThis and its clients in module scope.
async function loadPrismaModule(constructed: ConstructedClient[]): Promise<LoadedModule> {
  vi.resetModules();
  delete (globalThis as { prisma?: unknown }).prisma;

  class RecordingPrismaClient {
    readonly admins = {
      findMany: async (): Promise<unknown[]> => [],
    };

    constructor(options?: { readonly datasourceUrl?: string }) {
      constructed.push({ options });
    }
  }

  vi.doMock('@prisma/client', () => ({ PrismaClient: RecordingPrismaClient }));
  const loaded = await import('@/lib/prisma');
  return { getAdminReadClient: loaded.getAdminReadClient, PrismaClient: RecordingPrismaClient };
}

/** The source of a top-level function in admins.ts, from its signature to its closing brace. */
function functionSource(name: string): string {
  const start = ADMINS_SOURCE.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`admins.ts declares no ${name}()`);
  const end = ADMINS_SOURCE.indexOf('\n}', start);
  if (end < 0) throw new Error(`admins.ts ${name}() has no closing brace at column 0`);
  return ADMINS_SOURCE.slice(start, end + 2);
}

/** The `select: { … }` expression of a function body, whitespace collapsed. */
function selectExpression(body: string): string {
  const block = body.match(/select:\s*(\{[^}]*\})/);
  if (block === null) throw new Error('the admin read passes no select block');
  return block[0].slice('select:'.length).trim();
}

/** The columns a literal `select` object names, in written order. */
function literalColumns(select: string): string[] {
  return [...select.matchAll(/(\w+):\s*true/g)].map((match) => match[1]);
}

/** The columns an exported select constant names in prisma-selects.ts, in written order. */
function constantColumns(name: string): string[] {
  const start = SELECTS_SOURCE.indexOf(`export const ${name} = {`);
  if (start < 0) throw new Error(`prisma-selects.ts exports no ${name}`);
  const end = SELECTS_SOURCE.indexOf('}', start);
  return literalColumns(SELECTS_SOURCE.slice(start, end));
}

/** The columns the role's GRANT SELECT names on public.admins. */
function grantedColumns(): string[] {
  const grant = ROLES_MIGRATION.match(
    /GRANT SELECT \(([^)]*)\) ON public\.admins TO cms_admin_read_people/,
  );
  if (grant === null) throw new Error('the roles migration grants no SELECT to cms_admin_read_people');
  return grant[1].split(',').map((column) => column.trim());
}

const savedRoleUrl = process.env[ENV];
const savedPassword = process.env.ADMIN_LOGIN_DATABASE_URL;

beforeEach(() => {
  delete process.env[ENV];
});

afterEach(() => {
  vi.doUnmock('@prisma/client');
  vi.unstubAllEnvs();
  if (savedRoleUrl === undefined) delete process.env[ENV];
  else process.env[ENV] = savedRoleUrl;
  if (savedPassword === undefined) delete process.env.ADMIN_LOGIN_DATABASE_URL;
  else process.env.ADMIN_LOGIN_DATABASE_URL = savedPassword;
});

describe('the admin read client', () => {
  it('raises a named error and creates nothing when ADMIN_READ_DATABASE_URL is absent', async () => {
    // Both other connections are present and valid; neither may be borrowed.
    vi.stubEnv('DATABASE_URL', 'postgresql://cmsuser:***@database:5432/cmsdb');
    vi.stubEnv('ADMIN_LOGIN_DATABASE_URL', 'postgresql://cms_admin_login@database:5432/cmsdb');
    const constructed: ConstructedClient[] = [];
    const { getAdminReadClient } = await loadPrismaModule(constructed);
    const moduleLevelClients = constructed.length;

    expect(() => getAdminReadClient()).toThrowError(/ADMIN_READ_DATABASE_URL/);
    expect(() => getAdminReadClient()).toThrowError(/cms_admin_read_people role is not provisioned/);
    // Repeating the call re-raises: a failure is not cached into a usable client.
    expect(() => getAdminReadClient()).toThrowError(/ADMIN_READ_DATABASE_URL/);
    expect(constructed).toHaveLength(moduleLevelClients);
  });

  it('builds one usable, cached client over the role URL once the variable is set', async () => {
    process.env[ENV] = ROLE_URL;
    const constructed: ConstructedClient[] = [];
    const { getAdminReadClient, PrismaClient } = await loadPrismaModule(constructed);
    const moduleLevelClients = constructed.length;

    const client = getAdminReadClient();

    expect(client).toBeInstanceOf(PrismaClient);
    expect(typeof client.admins.findMany).toBe('function');
    expect(getAdminReadClient()).toBe(client);
    expect(constructed).toHaveLength(moduleLevelClients + 1);
    expect(constructed[moduleLevelClients].options?.datasourceUrl).toBe(ROLE_URL);
  });

  it('keeps the read and login variables distinct', async () => {
    // One variable for both would give the list the login's grant or the login the list's.
    process.env.ADMIN_LOGIN_DATABASE_URL = 'postgresql://cms_admin_login@database:5432/cmsdb';
    const constructed: ConstructedClient[] = [];
    const { getAdminReadClient } = await loadPrismaModule(constructed);

    expect(() => getAdminReadClient()).toThrowError(/ADMIN_READ_DATABASE_URL/);
    expect(constructed.some((entry) => entry.options?.datasourceUrl?.includes('cms_admin_login'))).toBe(false);
  });
});

describe('the admin list read', () => {
  it('reads the five granted columns over the read client', () => {
    const body = functionSource('getAdmins');

    expect(body).toContain('getAdminReadClient()');
    expect(body).not.toContain('prisma.admins');
    expect(selectExpression(body)).toBe('{ ...safeAdminSelect, last_login_at: true }');
    expect([...constantColumns('safeAdminSelect'), 'last_login_at']).toEqual(GRANTED_COLUMNS);
    expect(grantedColumns()).toEqual(GRANTED_COLUMNS);
  });

  it('never names the application connection or its role', () => {
    // Source assertion: the failure mode is a fallback written later, and naming the token is how it starts.
    expect(ADMINS_SOURCE).not.toMatch(/\bDATABASE_URL\b/);
    expect(ADMINS_SOURCE).not.toMatch(/cmsuser/i);
    expect(ADMINS_SOURCE).toMatch(/import \{[^}]*getAdminReadClient[^}]*\} from '@\/lib\/prisma'/);
  });

  it('leaves the admin mutations off the read client', () => {
    // The read role holds SELECT on five columns and no write, and authentication is not in its grant.
    for (const name of ['createAdmin', 'updateAdmin', 'deleteAdmin', 'revealAdminPassword']) {
      const body = functionSource(name);
      expect(body, `${name}() moved to the read client`).not.toContain('getAdminReadClient');
    }
    expect(functionSource('revealAdminPassword')).toContain('getAdminSecurityClient');
  });
});
