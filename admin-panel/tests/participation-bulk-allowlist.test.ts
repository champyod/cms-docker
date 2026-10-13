import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  participationsFindMany: vi.fn(),
  usersCreate: vi.fn(),
  executeRawUnsafe: vi.fn(),
  resolveTeamIdByCode: vi.fn(),
  recordAudit: vi.fn(),
  resyncRankingUsers: vi.fn(),
  verifyApiPermission: vi.fn(),
  getPermissions: vi.fn(),
  ensurePermission: vi.fn(),
  prepareRow: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    participations: { findMany: mocks.participationsFindMany },
    users: { create: mocks.usersCreate },
    $executeRawUnsafe: mocks.executeRawUnsafe,
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }));
vi.mock('@/lib/ranking-projection', () => ({
  resyncRankingUsers: mocks.resyncRankingUsers,
  resyncActiveRankingUsers: vi.fn(),
}));
vi.mock('@/lib/permissions', () => ({
  ensurePermission: mocks.ensurePermission,
  getPermissions: mocks.getPermissions,
  getFreshPermissions: vi.fn(async () => new Set(['participation:update'])),
}));
vi.mock('@/lib/api-utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-utils')>()),
  verifyApiPermission: mocks.verifyApiPermission,
}));
vi.mock('@/lib/teams', () => ({ resolveTeamIdByCode: mocks.resolveTeamIdByCode }));
vi.mock('@/lib/creds-file', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/creds-file')>()),
  cleanupExpiredCreds: vi.fn(async () => {}),
}));
vi.mock('@/lib/password-format', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/password-format')>()),
  formatStoredPassword: vi.fn(async () => 'stored-hash'),
}));
vi.mock('@/app/api/users/bulk/bulkRowPreparation', () => ({
  prepareRow: mocks.prepareRow,
  shouldGeneratePassword: () => false,
}));

import { applyBulkParticipationSettings } from '@/app/actions/participation-settings';
import { handleParticipation } from '@/app/api/users/batch/participationActions';
import { POST as bulkCreate } from '@/app/api/users/bulk/route';

const CONTEST_ID = 5;
const ALLOWLIST = '10.0.0.0/8';

function jsonRequest(body: unknown): { json: () => Promise<unknown> } {
  return { json: async () => body };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.recordAudit.mockResolvedValue(undefined);
  mocks.resyncRankingUsers.mockResolvedValue(undefined);
  mocks.executeRawUnsafe.mockResolvedValue(1);
  mocks.ensurePermission.mockResolvedValue(undefined);
  mocks.getPermissions.mockResolvedValue(new Set(['participation:update']));
  mocks.verifyApiPermission.mockResolvedValue({
    authorized: true,
    session: { userId: '1', username: 'admin', expiresAt: new Date().toISOString() },
  });
  mocks.prepareRow.mockResolvedValue({
    rowIndex: 2,
    firstName: 'Ada',
    lastName: 'Lovelace',
    username: 'ada.lovelace',
    plainPassword: 'secret',
    email: '',
    timezone: '',
    teamCode: '',
    hadExplicitPassword: true,
    preferredLanguages: [],
  });
  mocks.usersCreate.mockResolvedValue({ id: 77 });
  mocks.resolveTeamIdByCode.mockResolvedValue(null);
});

describe('batch participation/ip writes through the shared action', () => {
  it('sets the allowlist on every selected participation in one write', async () => {
    mocks.participationsFindMany.mockResolvedValueOnce([{ id: 10 }, { id: 11 }]);

    const response = await handleParticipation({
      body: { mode: 'ip', contestId: CONTEST_ID, ip: ALLOWLIST },
      userIds: [1, 2],
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, updatedCount: 2 });
    const [query, ...params] = mocks.executeRawUnsafe.mock.calls[0];
    expect(String(query)).toContain('ip = ARRAY[$1::cidr]');
    expect(params).toEqual([ALLOWLIST, [10, 11]]);
  });

  it('rejects an invalid CIDR allowlist with the validator error', async () => {
    const response = await handleParticipation({
      body: { mode: 'ip', contestId: CONTEST_ID, ip: '999.1.1.1' },
      userIds: [1],
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('Invalid IP or CIDR');
    expect(mocks.executeRawUnsafe).not.toHaveBeenCalled();
  });
});

describe('the shared action strips an allowlist the caller may not set', () => {
  it('drops ip when the caller lacks participation:update rather than writing it', async () => {
    mocks.getPermissions.mockResolvedValueOnce(new Set(['participation:read']));
    mocks.participationsFindMany.mockResolvedValueOnce([{ id: 10 }]);

    const result = await applyBulkParticipationSettings(CONTEST_ID, [1], { ip: ALLOWLIST }, 'test-strip');

    expect(result.success).toBe(true);
    expect(mocks.executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('writes ip when the caller holds participation:update', async () => {
    mocks.participationsFindMany.mockResolvedValueOnce([{ id: 10 }]);

    await applyBulkParticipationSettings(CONTEST_ID, [1], { ip: ALLOWLIST }, 'test-write');

    const [query, ...params] = mocks.executeRawUnsafe.mock.calls[0];
    expect(String(query)).toContain('ip = ARRAY[$1::cidr]');
    expect(params).toEqual([ALLOWLIST, [10]]);
  });
});

describe('bulk create carries the validated allowlist', () => {
  it('inserts each created participation with the ip column', async () => {
    const response = await bulkCreate(
      jsonRequest({ rows: [{ first_name: 'Ada', last_name: 'Lovelace' }], generationMode: 'none', contestId: CONTEST_ID, ip: ALLOWLIST }) as never,
    );

    expect(response.status).toBe(200);
    const [query, ...params] = mocks.executeRawUnsafe.mock.calls[0];
    expect(String(query)).toContain(', ip');
    expect(String(query)).toContain('ARRAY[$1::cidr]');
    expect(params).toEqual([ALLOWLIST, CONTEST_ID, 77, null]);
  });

  it('refuses an invalid allowlist before creating any user', async () => {
    const response = await bulkCreate(
      jsonRequest({ rows: [{ first_name: 'Ada', last_name: 'Lovelace' }], generationMode: 'none', contestId: CONTEST_ID, ip: '10.10.0.0/10' }) as never,
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('Misaligned CIDR');
    expect(mocks.usersCreate).not.toHaveBeenCalled();
  });
});
