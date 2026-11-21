import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Why: vitest runs ESM where __dirname is undefined — derive it so the
// source-consumer guard below resolves the service files the same way.
const testDir = dirname(fileURLToPath(import.meta.url));

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getFreshPermissions: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }));
vi.mock('@/lib/permissions', () => ({
  getFreshPermissions: mocks.getFreshPermissions,
}));

import {
  AuthorizationError,
  requirePermission,
} from '@/lib/server/authorization';

const readSource = (relativePath: string): string =>
  readFileSync(join(testDir, '..', relativePath), 'utf8');

describe('requirePermission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws the existing 401 contract when no session exists', async () => {
    mocks.getSession.mockResolvedValue(null);

    await expect(requirePermission('contest:list')).rejects.toMatchObject({
      name: 'AuthorizationError',
      status: 401,
      message: 'Unauthorized',
    });
    expect(mocks.getFreshPermissions).not.toHaveBeenCalled();
  });

  it('throws the existing 403 contract when effective permissions cannot resolve', async () => {
    mocks.getSession.mockResolvedValue({ userId: '7' });
    mocks.getFreshPermissions.mockResolvedValue(null);

    await expect(requirePermission('contest:list')).rejects.toMatchObject({
      name: 'AuthorizationError',
      status: 403,
      permission: 'contest:list',
      message: 'Unauthorized: Missing contest:list permission',
    });
  });

  it('throws 403 with the missing PermissionKey', async () => {
    mocks.getSession.mockResolvedValue({ userId: '7' });
    mocks.getFreshPermissions.mockResolvedValue(new Set(['task:list']));

    await expect(requirePermission('contest:list')).rejects.toMatchObject({
      status: 403,
      permission: 'contest:list',
    });
  });

  it('returns the same effective set used by field stripping', async () => {
    const effective = new Set(['contest:create', 'contest:update']);
    mocks.getSession.mockResolvedValue({ userId: '7' });
    mocks.getFreshPermissions.mockResolvedValue(effective);

    await expect(requirePermission('contest:create')).resolves.toBe(effective);
  });

  it('keeps the audited all:all bypass', async () => {
    mocks.getSession.mockResolvedValue({ userId: '7' });
    mocks.getFreshPermissions.mockResolvedValue(new Set(['all:all']));

    await expect(requirePermission('backup:create')).resolves.toEqual(new Set(['all:all']));
  });

  it('is an Error subclass with a stable name', () => {
    const error = new AuthorizationError(403, 'task:read');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AuthorizationError');
  });
});

describe('service consumers', () => {
  it('removes both duplicate private guards', () => {
    for (const relativePath of [
      'src/lib/services/contests.ts',
      'src/lib/services/tasks.ts',
    ]) {
      const source = readSource(relativePath);
      expect(source).toContain("from '@/lib/server/authorization'");
      expect(source).not.toMatch(/async function requirePermission/);
      expect(source).not.toContain("from '@/lib/auth'");
      expect(source).not.toContain("from '@/lib/permissions'");
      expect(source).not.toContain("from '@/lib/permission-engine'");
    }
  });
});
