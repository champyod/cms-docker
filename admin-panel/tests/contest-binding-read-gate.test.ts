import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GROUPS } from '@/lib/permission-groups';

/**
 * The bound-contest read opens config.toml itself, where every other config.toml read goes through
 * the audited reader (src/app/actions/configTomlActions.ts). These tests pin both halves of that
 * parity: the env:read + env:list gate that reader demands, and the config:view row it leaves.
 */
const SHARD_TOML = '[contest]\nCONTEST_ID = 1\nCONTEST_WEB_SERVER_SHARD = 2\n';

const mocks = vi.hoisted(() => ({ recordAudit: vi.fn(async () => {}) }));

function groupKeys(name: string): string[] {
  const group = DEFAULT_GROUPS.find((definition) => definition.name === name);
  if (group === undefined) throw new Error(`DEFAULT_GROUPS has no group named "${name}"`);
  return [...group.permissions];
}

/** The group_permissions rows the seed writes for this group, in the shape getFreshPermissions reads. */
function groupPermissionRows(name: string): Array<{ permissions: { key: string } }> {
  return groupKeys(name).map((key) => ({ permissions: { key } }));
}

function loadContestServiceAs(roleName: string, readFile: () => Promise<string>) {
  vi.doMock('@/lib/auth', () => ({
    getSession: vi.fn(async () => ({
      userId: '4242',
      username: 'operator',
      expiresAt: new Date().toISOString(),
    })),
  }));
  vi.doMock('@/lib/prisma', () => ({
    prisma: {
      admins: {
        findUnique: vi.fn(async () => ({
          enabled: true,
          admin_groups: [{ groups: { group_permissions: groupPermissionRows(roleName) } }],
          permission_overrides: [],
        })),
      },
      services: { findMany: vi.fn(async () => [{ shard: 2, contest_id: 3 }]) },
    },
  }));
  vi.doMock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }));
  vi.doMock('fs/promises', () => ({ default: { readFile } }));
  return import('@/lib/services/contests');
}

describe('the bound contest read carries the config.toml reader parity', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.recordAudit.mockClear();
  });

  it('reads the binding for a role holding contest:list and the env reader keys', async () => {
    const keys = groupKeys('Storage');
    expect(keys).toEqual(expect.arrayContaining(['contest:list', 'env:read', 'env:list']));

    const { getBoundContestId } = await loadContestServiceAs('Storage', async () => SHARD_TOML);
    await expect(getBoundContestId()).resolves.toEqual({
      success: true,
      binding: { source: 'registry', contestId: 3, matchedBy: 'declared-shard' },
    });
  });

  it('records the row that answered, so a declared shard the registry does not carry shows', async () => {
    const { getBoundContestId } = await loadContestServiceAs('Storage', async () => '[contest]\nCONTEST_WEB_SERVER_SHARD = 9\n');
    await getBoundContestId();

    expect(mocks.recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      verb: 'config:view',
      result: 'success',
      afterValues: expect.objectContaining({ bindingMatchedBy: 'consensus' }),
    }));
  });

  it('answers the compose default shard for a deployment with no config.toml yet', async () => {
    const missing = Object.assign(new Error('config.toml'), { code: 'ENOENT' });
    const { getBoundContestId } = await loadContestServiceAs('Storage', async () => {
      throw missing;
    });

    // Shard 0 names no row of the registry's rows (shard 2), so the row the enabled servers agree
    // on answers — the read still succeeds, which is the whole point of the default.
    await expect(getBoundContestId()).resolves.toEqual({
      success: true,
      binding: { source: 'registry', contestId: 3, matchedBy: 'consensus' },
    });
    expect(mocks.recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      verb: 'config:view',
      result: 'success',
    }));
  });

  it('names only the shard key in the config:view row it leaves', async () => {
    const { getBoundContestId } = await loadContestServiceAs('Storage', async () => SHARD_TOML);
    await getBoundContestId();

    expect(mocks.recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      verb: 'config:view',
      entity: 'config',
      afterValues: {
        file: 'config.toml',
        requestedKeys: ['contest.CONTEST_WEB_SERVER_SHARD'],
        bindingMatchedBy: 'declared-shard',
      },
      result: 'success',
    }));
  });

  it('refuses the role the audited reader refuses', async () => {
    // The premise: this role may list contests, so only the env key can be what refuses it.
    expect(groupKeys('Judge')).toContain('contest:list');
    expect(groupKeys('Judge')).not.toContain('env:read');

    const { getBoundContestId } = await loadContestServiceAs('Judge', async () => SHARD_TOML);
    await expect(getBoundContestId()).rejects.toThrow(/env:read/);
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it('records the same failure row the audited reader records', async () => {
    const refusal = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const { getBoundContestId } = await loadContestServiceAs('Storage', async () => {
      throw refusal;
    });

    const result = await getBoundContestId();
    expect(result.success).toBe(false);
    // The refusal names the file and its errno, the way config-file's own fault does.
    expect(result.error).toMatch(/^EACCES: .*config\.toml$/);
    expect(mocks.recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      verb: 'config:view',
      entity: 'config',
      afterValues: { file: 'config.toml', error: 'Error' },
      result: 'failure',
    }));
  });
});
