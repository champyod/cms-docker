import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';

// Pin the connection: the application role holds every column, so a mutation through it would go unnoticed.

const ENV = 'ADMIN_SECURITY_DATABASE_URL';
const ROLE_URL = 'postgresql://cms_admin_account_security@database:5432/cmsdb';
const PANEL_ROOT = path.resolve(__dirname, '..');
const ADMINS_SOURCE = fs.readFileSync(path.join(PANEL_ROOT, 'src', 'app', 'actions', 'admins.ts'), 'utf8');
const UPDATE_HELPERS_SOURCE = fs.readFileSync(
  path.join(PANEL_ROOT, 'src', 'app', 'actions', 'admin-update-helpers.ts'),
  'utf8',
);
const ROLES_MIGRATION = fs.readFileSync(
  path.join(PANEL_ROOT, 'prisma', 'sql', '20260820110000_generated_roles.sql'),
  'utf8',
);

interface ConstructedClient {
  readonly options?: { readonly datasourceUrl?: string };
}

type FakePrismaClient = new (options?: { readonly datasourceUrl?: string }) => {
  readonly admins: {
    findUnique: () => Promise<unknown>;
    create: () => Promise<unknown>;
    delete: () => Promise<unknown>;
  };
};

interface LoadedModule {
  readonly getAdminSecurityClient: typeof import('@/lib/prisma').getAdminSecurityClient;
  readonly PrismaClient: FakePrismaClient;
}

// Fresh module per case: the wrapper is cached on globalThis and its clients in module scope.
async function loadPrismaModule(constructed: ConstructedClient[]): Promise<LoadedModule> {
  vi.resetModules();
  delete (globalThis as { prisma?: unknown }).prisma;

  class RecordingPrismaClient {
    readonly admins = {
      findUnique: async (): Promise<unknown> => null,
      create: async (): Promise<unknown> => ({ id: 1 }),
      delete: async (): Promise<unknown> => ({ id: 1 }),
    };

    constructor(options?: { readonly datasourceUrl?: string }) {
      constructed.push({ options });
    }
  }

  vi.doMock('@prisma/client', () => ({ PrismaClient: RecordingPrismaClient }));
  const loaded = await import('@/lib/prisma');
  return { getAdminSecurityClient: loaded.getAdminSecurityClient, PrismaClient: RecordingPrismaClient };
}

/** The source of a top-level function in `source`, from its signature to its closing brace. */
function functionSource(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`no ${name}() in the action source`);
  const end = source.indexOf('\n}', start);
  if (end < 0) throw new Error(`${name}() has no closing brace at column 0`);
  return source.slice(start, end + 2);
}

/** The columns a `GRANT <privilege> (…) ON public.admins TO cms_admin_account_security` names. */
function grantedColumns(privilege: 'SELECT' | 'UPDATE' | 'INSERT'): string[] {
  const grant = ROLES_MIGRATION.match(
    new RegExp(
      `GRANT ${privilege} \\(([^)]*)\\) ON public\\.admins TO cms_admin_account_security`,
    ),
  );
  if (grant === null) throw new Error(`the roles migration grants no ${privilege} to cms_admin_account_security`);
  return grant[1].split(',').map((column) => column.trim());
}

const savedSecurityUrl = process.env[ENV];
const savedReadUrl = process.env.ADMIN_READ_DATABASE_URL;
const savedLoginUrl = process.env.ADMIN_LOGIN_DATABASE_URL;

beforeEach(() => {
  delete process.env[ENV];
});

afterEach(() => {
  vi.doUnmock('@prisma/client');
  vi.unstubAllEnvs();
  if (savedSecurityUrl === undefined) delete process.env[ENV];
  else process.env[ENV] = savedSecurityUrl;
  if (savedReadUrl === undefined) delete process.env.ADMIN_READ_DATABASE_URL;
  else process.env.ADMIN_READ_DATABASE_URL = savedReadUrl;
  if (savedLoginUrl === undefined) delete process.env.ADMIN_LOGIN_DATABASE_URL;
  else process.env.ADMIN_LOGIN_DATABASE_URL = savedLoginUrl;
});

describe('the admin account-security client', () => {
  it('raises a named error and creates nothing when ADMIN_SECURITY_DATABASE_URL is absent', async () => {
    // The other admin connections are present and valid; none may be borrowed.
    vi.stubEnv('DATABASE_URL', 'postgresql://cmsuser:***@database:5432/cmsdb');
    vi.stubEnv('ADMIN_LOGIN_DATABASE_URL', 'postgresql://cms_admin_login@database:5432/cmsdb');
    vi.stubEnv('ADMIN_READ_DATABASE_URL', 'postgresql://cms_admin_read_people@database:5432/cmsdb');
    const constructed: ConstructedClient[] = [];
    const { getAdminSecurityClient } = await loadPrismaModule(constructed);
    const moduleLevelClients = constructed.length;

    expect(() => getAdminSecurityClient()).toThrowError(/ADMIN_SECURITY_DATABASE_URL/);
    expect(() => getAdminSecurityClient()).toThrowError(/cms_admin_account_security role is not provisioned/);
    // Repeating the call re-raises: a failure is not cached into a usable client.
    expect(() => getAdminSecurityClient()).toThrowError(/ADMIN_SECURITY_DATABASE_URL/);
    expect(constructed).toHaveLength(moduleLevelClients);
  });

  it('builds one usable, cached client over the role URL once the variable is set', async () => {
    process.env[ENV] = ROLE_URL;
    const constructed: ConstructedClient[] = [];
    const { getAdminSecurityClient, PrismaClient } = await loadPrismaModule(constructed);
    const moduleLevelClients = constructed.length;

    const client = getAdminSecurityClient();

    expect(client).toBeInstanceOf(PrismaClient);
    expect(typeof client.admins.findUnique).toBe('function');
    expect(getAdminSecurityClient()).toBe(client);
    expect(constructed).toHaveLength(moduleLevelClients + 1);
    expect(constructed[moduleLevelClients].options?.datasourceUrl).toBe(ROLE_URL);
  });

  it('keeps the security, read and login variables distinct', async () => {
    // One variable answering for another would give a mutation a grant without the write it needs.
    process.env.ADMIN_READ_DATABASE_URL = 'postgresql://cms_admin_read_people@database:5432/cmsdb';
    process.env.ADMIN_LOGIN_DATABASE_URL = 'postgresql://cms_admin_login@database:5432/cmsdb';
    const constructed: ConstructedClient[] = [];
    const { getAdminSecurityClient } = await loadPrismaModule(constructed);

    expect(() => getAdminSecurityClient()).toThrowError(/ADMIN_SECURITY_DATABASE_URL/);
    expect(constructed.some((entry) => entry.options?.datasourceUrl?.includes('cms_admin_'))).toBe(false);
  });
});

describe('the admin account mutations', () => {
  it('creates, deletes and reveals over the security client', () => {
    expect(functionSource(ADMINS_SOURCE, 'createAdmin')).toContain('getAdminSecurityClient().admins.create');
    expect(functionSource(ADMINS_SOURCE, 'revealAdminPassword')).toContain(
      'getAdminSecurityClient().admins.findUnique',
    );

    const deleteBody = functionSource(ADMINS_SOURCE, 'deleteAdmin');
    expect(deleteBody).toContain('const security = getAdminSecurityClient()');
    expect(deleteBody).toContain('security.admins.findUnique');
    expect(deleteBody).toContain('security.admins.delete');
    // Explicit select: the role cannot read last_login_at, so a bare delete's RETURNING would be refused.
    expect(deleteBody).toContain('select: { id: true }');
  });

  it('reads the before row and writes the update over the security client', () => {
    const body = functionSource(UPDATE_HELPERS_SOURCE, 'handleAdminUpdateWrite');

    expect(body).toContain('const security = getAdminSecurityClient()');
    expect(body).toContain('security.admins.findUnique');
    expect(body).toContain('security.admins.update');
    expect(body).toContain('select: { id: true }');
  });

  it('never names the application connection, its role, or prisma.admins', () => {
    // Source assertion: the failure mode is a fallback written later, and naming the token is how it starts.
    for (const [label, source] of [
      ['admins.ts', ADMINS_SOURCE],
      ['admin-update-helpers.ts', UPDATE_HELPERS_SOURCE],
    ] as const) {
      expect(source, `${label} names prisma.admins`).not.toMatch(/prisma\.admins/);
      expect(source, `${label} names DATABASE_URL`).not.toMatch(/\bDATABASE_URL\b/);
      expect(source, `${label} names cmsuser`).not.toMatch(/cmsuser/i);
      expect(source, `${label} does not import the security client`).toMatch(
        /import \{[^}]*getAdminSecurityClient[^}]*\} from '@\/lib\/prisma'/,
      );
    }
  });

  it('carries exactly the columns the mutations read and write in the role grant', () => {
    expect(grantedColumns('SELECT')).toEqual(['id', 'username', 'name', 'enabled', 'authentication']);
    expect(grantedColumns('UPDATE')).toEqual(['name', 'username', 'authentication', 'enabled']);
    // The insert path is unchanged: the four columns createAdmin writes, plus the sequence.
    expect(grantedColumns('INSERT')).toEqual(['username', 'authentication', 'enabled', 'name']);
    expect(ROLES_MIGRATION).toMatch(
      /GRANT DELETE ON public\.admins TO cms_admin_account_security/,
    );
  });
});

describe('runtime — the mutations use the security delegates', () => {
  interface Delegates {
    security: Record<string, ReturnType<typeof vi.fn>>;
    application: Record<string, ReturnType<typeof vi.fn>>;
  }

  const MOCKED_MODULES = [
    '@/lib/permissions',
    '@/lib/auth',
    '@/lib/audit',
    '@/lib/admin-helpers',
    '@/lib/server/target-permissions',
    '@/lib/prisma',
    'next/cache',
  ] as const;

  afterEach(() => {
    for (const moduleName of MOCKED_MODULES) vi.doUnmock(moduleName);
  });

  async function loadAdminsActions(): Promise<Delegates> {
    vi.resetModules();
    const security = {
      findUnique: vi.fn(async () => ({ username: 'target', name: 'Target', enabled: true, authentication: `bcrypt:${bcrypt.hashSync('secret', 10)}` })),
      create: vi.fn(async () => ({ id: 9 })),
      update: vi.fn(async () => ({ id: 2 })),
      delete: vi.fn(async () => ({ id: 2 })),
      findMany: vi.fn(async () => []),
    };
    const application = {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: 1 })),
      update: vi.fn(async () => ({ id: 1 })),
      delete: vi.fn(async () => ({ id: 1 })),
    };

    vi.doMock('@/lib/permissions', () => ({
      ensurePermission: vi.fn(async () => {}),
      getPermissions: vi.fn(async () => new Set<string>(['all:all'])),
      invalidateAccessCache: vi.fn(),
    }));
    vi.doMock('@/lib/auth', () => ({
      getSession: vi.fn(async () => ({ userId: '1', username: 'caller', expiresAt: new Date().toISOString() })),
    }));
    vi.doMock('@/lib/audit', () => ({ recordAudit: vi.fn(async () => {}) }));
    vi.doMock('@/lib/server/target-permissions', () => ({
      getTargetEffectivePermissions: vi.fn(async () => ({ status: 'resolved' as const, effective: new Set<string>() })),
    }));
    vi.doMock('@/lib/admin-helpers', () => ({
      findAdminTarget: vi.fn(async () => ({ id: 2, username: 'target', enabled: true, admin_groups: [] })),
      isSelfDemotion: vi.fn(() => false),
      isCurrentlySuperadmin: vi.fn(() => false),
      removesSuperadminStatusViaGroups: vi.fn(() => false),
      wouldRemoveLastSuperadmin: vi.fn(async () => false),
      buildAdminUpdateData: vi.fn(async (data: unknown) => data),
    }));
    vi.doMock('@/lib/prisma', () => ({
      getAdminSecurityClient: () => ({ admins: security }),
      getAdminReadClient: () => ({ admins: { findMany: security.findMany } }),
      prisma: { admins: application },
    }));
    vi.doMock('next/cache', () => ({ revalidatePath: vi.fn() }));

    return { security, application };
  }

  it('createAdmin writes through the security delegate, never the application one', async () => {
    const { security, application } = await loadAdminsActions();
    const { createAdmin } = await import('@/app/actions/admins');

    const result = await createAdmin({ name: 'Ada', username: 'ada', password: 'secret123' });

    expect(result).toEqual({ success: true });
    expect(security.create).toHaveBeenCalledTimes(1);
    expect(security.create.mock.calls[0][0]).toMatchObject({
      data: { name: 'Ada', username: 'ada', enabled: true },
      select: { id: true },
    });
    expect(application.create).not.toHaveBeenCalled();
    expect(security.create.mock.calls[0][0].data.authentication).toMatch(/^bcrypt:/);
  });

  it('ignores a plaintext passwordKind on create', async () => {
    const { security } = await loadAdminsActions();
    const { createAdmin } = await import('@/app/actions/admins');

    const result = await createAdmin({ name: 'Ada', username: 'ada', password: 'secret123', passwordKind: 'plaintext' } as never);

    expect(result).toEqual({ success: true });
    expect(security.create.mock.calls[0][0].data.authentication).toMatch(/^bcrypt:/);
  });

  it('deleteAdmin deletes through the security delegate, never the application one', async () => {
    const { security, application } = await loadAdminsActions();
    const { deleteAdmin } = await import('@/app/actions/admins');

    const result = await deleteAdmin(2);

    expect(result).toEqual({ success: true });
    expect(security.findUnique).toHaveBeenCalledWith({
      where: { id: 2 },
      select: { username: true, name: true, enabled: true },
    });
    expect(security.delete).toHaveBeenCalledWith({ where: { id: 2 }, select: { id: true } });
    expect(application.delete).not.toHaveBeenCalled();
  });

  it('revealAdminPassword reads the credential through the security delegate', async () => {
    const { security, application } = await loadAdminsActions();
    const { revealAdminPassword } = await import('@/app/actions/admins');

    const result = await revealAdminPassword(2);

    expect(result).toEqual({ success: true, kind: 'bcrypt' });
    expect(security.findUnique).toHaveBeenCalledWith({ where: { id: 2 }, select: { authentication: true } });
    expect(application.findUnique).not.toHaveBeenCalled();
  });

  it('never reveals a legacy plaintext credential', async () => {
    const { security } = await loadAdminsActions();
    security.findUnique.mockResolvedValueOnce({ authentication: 'plaintext:secret' });
    const { revealAdminPassword } = await import('@/app/actions/admins');

    const result = await revealAdminPassword(2);

    expect(result).toEqual({ success: false, error: 'This password is stored in an unsupported format; reset it.' });
  });
});
