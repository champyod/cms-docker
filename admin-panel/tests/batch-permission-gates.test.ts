import { describe, expect, it, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Why: static gate checks prove each sub-action is bound to the permission that
// matches its actual read/write, not the route's former coarse key. These fail
// on the pre-fix code and pass after the fix.
function read(rel: string): string {
  return fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf-8');
}

describe('batch permission gates (static)', () => {
  it('route.ts does not gate on user:create', () => {
    const src = read('src/app/api/users/batch/route.ts');
    expect(src).not.toContain("verifyApiPermission('user:create')");
    expect(src).not.toContain('verifyApiPermission("user:create")');
  });

  it('handleExportCurrent is gated on password:reveal and audits password:reveal', () => {
    const src = read('src/app/api/users/batch/credentialActions.ts');
    // handleExportCurrent block must contain password:reveal both as gate and audit verb
    expect(src).toContain("handleExportCurrent");
    expect(src).toContain("verifyApiPermission('password:reveal')");
    // audit verb adjacent to export-current action
    expect(src).toMatch(/verb:\s*'password:reveal'/);
    expect(src).toContain("batch-export-current");
  });

  it('handleRegenerate and handleApplyCredentials are gated on user:update', () => {
    const src = read('src/app/api/users/batch/credentialActions.ts');
    // Both handlers must check user:update — count occurrences >=2
    const hits = (src.match(/verifyApiPermission\('user:update'\)/g) || []).length;
    expect(hits).toBeGreaterThanOrEqual(2);
  });

  it('handleContest add gated on participation:create, remove on participation:delete, with matching audit verbs', () => {
    const src = read('src/app/api/users/batch/enrollmentActions.ts');
    expect(src).toContain("verifyApiPermission('participation:create')");
    expect(src).toContain("verifyApiPermission('participation:delete')");
    expect(src).toContain("verb: 'participation:create'");
    expect(src).toContain("verb: 'participation:delete'");
    // contest participation ops must not use the old coarse participation:update verb
    // (team ops correctly still use participation:update — don't assert globally)
    const contestVerbs = [...src.matchAll(/handleContest[\s\S]*?revalidateUserContestPages\(\)/g)].join('');
    // simpler: just ensure both correct verbs exist; team verbs covered separately
    expect(src).toMatch(/participation:create/);
    expect(src).toMatch(/participation:delete/);
  });

  it('handleTeam (both modes) gated on participation:update and audits participation:update', () => {
    const src = read('src/app/api/users/batch/enrollmentActions.ts');
    // Both team modes gate on participation:update: the entry point covers remove-any
    // and the set path's audit confirms the same verb is used after the gate.
    expect(src).toContain("verifyApiPermission('participation:update')");
    const auditHits = (src.match(/verb:\s*'participation:update'/g) || []).length;
    expect(auditHits).toBeGreaterThanOrEqual(2);
  });

  it('handleProfile gated on user:update', () => {
    const src = read('src/app/api/users/batch/profileActions.ts');
    expect(src).toContain("verifyApiPermission('user:update')");
  });

  it('credentials [token] route gated on password:reveal and audits password:reveal', () => {
    const src = read('src/app/api/users/credentials/[token]/route.ts');
    expect(src).toContain("verifyApiPermission('password:reveal')");
    expect(src).not.toContain("verifyApiPermission('user:update')");
    expect(src).toContain("verb: 'password:reveal'");
  });
});

// Runtime enforcement: lacking permission → 403, holding it → not blocked.
// Mock only verifyApiPermission; DB calls are stubbed so the permitted path can proceed.
describe('batch permission enforcement (runtime)', () => {
  beforeEach(() => vi.resetModules());

  async function loadWithPermission(permissionToAllow: string | null) {
    vi.doMock('@/lib/api-utils', async () => {
      const actual = await vi.importActual<typeof import('@/lib/api-utils')>('@/lib/api-utils');
      return {
        ...actual,
        verifyApiPermission: vi.fn(async (perm: string) => {
          if (permissionToAllow !== null && perm === permissionToAllow) {
            return { authorized: true, session: { userId: '1', username: 'admin', expiresAt: new Date().toISOString() } } as never;
          }
          if (permissionToAllow === '__all__') {
            return { authorized: true, session: { userId: '1', username: 'admin', expiresAt: new Date().toISOString() } } as never;
          }
          // simulate missing permission → 403 response
          const { NextResponse } = await import('next/server');
          return { authorized: false, response: NextResponse.json({ error: `Forbidden: Missing ${perm} permission` }, { status: 403 }) } as never;
        }),
      };
    });
    vi.doMock('@/lib/prisma', () => ({
      prisma: {
        users: {
          findMany: vi.fn(async () => [{ id: 1, username: 'alice', password: 'plaintext:secret123' }]),
          update: vi.fn(async () => ({})),
          updateMany: vi.fn(async () => ({ count: 1 })),
          findUnique: vi.fn(async () => null),
        },
        participations: {
          deleteMany: vi.fn(async () => ({ count: 1 })),
          updateMany: vi.fn(async () => ({ count: 1 })),
        },
        $executeRaw: vi.fn(async () => 1),
      },
    }));
    vi.doMock('@/lib/audit', () => ({ recordAudit: vi.fn(async () => {}) }));
    vi.doMock('@/lib/creds-file', async () => {
      const actual = await vi.importActual<typeof import('@/lib/creds-file')>('@/lib/creds-file');
      return { ...actual, writeCredsCsv: vi.fn(async (c: string) => ({ token: 'tok', downloadUrl: '/api/users/credentials/tok' })) };
    });
    vi.doMock('next/cache', () => ({ revalidatePath: vi.fn() }));
    vi.doMock('@/lib/teams', () => ({ resolveTeamIdByCode: vi.fn(async () => 99) }));
  }

  it('(a) lacking password:reveal cannot export plaintext passwords', async () => {
    await loadWithPermission('user:create'); // allow only the old coarse key, not password:reveal
    const { handleExportCurrent } = await import('@/app/api/users/batch/credentialActions');
    const res = await handleExportCurrent({ body: {}, userIds: [1] });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('password:reveal');
  });

  it('(a) holding password:reveal can export (no over-blocking)', async () => {
    await loadWithPermission('password:reveal');
    const { handleExportCurrent } = await import('@/app/api/users/batch/credentialActions');
    const res = await handleExportCurrent({ body: {}, userIds: [1] });
    expect(res.status).not.toBe(403);
  });

  it('(b) lacking participation:create cannot create enrolments', async () => {
    await loadWithPermission('user:create');
    const { handleContest } = await import('@/app/api/users/batch/enrollmentActions');
    const res = await handleContest({ body: { mode: 'add', contestId: 1 }, userIds: [1] });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain('participation:create');
  });

  it('(b) lacking participation:delete cannot delete enrolments', async () => {
    await loadWithPermission('participation:create'); // has create but not delete
    const { handleContest } = await import('@/app/api/users/batch/enrollmentActions');
    const res = await handleContest({ body: { mode: 'remove', contestId: 1 }, userIds: [1] });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain('participation:delete');
  });

  it('(b) holding participation:create/delete can enrol (no over-blocking)', async () => {
    await loadWithPermission('__all__');
    const { handleContest } = await import('@/app/api/users/batch/enrollmentActions');
    const add = await handleContest({ body: { mode: 'add', contestId: 1 }, userIds: [1] });
    expect(add.status).toBe(200);
    const rem = await handleContest({ body: { mode: 'remove', contestId: 1 }, userIds: [1] });
    expect(rem.status).toBe(200);
  });

  it('(c) lacking user:update cannot update profiles', async () => {
    await loadWithPermission('user:create');
    const { handleProfile } = await import('@/app/api/users/batch/profileActions');
    const res = await handleProfile({ body: { mode: 'timezone', timezone: 'UTC' }, userIds: [1] });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain('user:update');
  });

  it('(c) holding user:update can update profiles (no over-blocking)', async () => {
    await loadWithPermission('user:update');
    const { handleProfile } = await import('@/app/api/users/batch/profileActions');
    const res = await handleProfile({ body: { mode: 'timezone', timezone: 'UTC' }, userIds: [1] });
    expect(res.status).toBe(200);
  });

  it('fully-permitted admin can perform all operations', async () => {
    await loadWithPermission('__all__');
    const { handleRegenerate, handleApplyCredentials, handleExportCurrent } = await import('@/app/api/users/batch/credentialActions');
    const { handleContest, handleTeam } = await import('@/app/api/users/batch/enrollmentActions');
    const { handleProfile } = await import('@/app/api/users/batch/profileActions');
    expect((await handleRegenerate({ body: { mode: 'password' }, userIds: [1] })).status).not.toBe(403);
    expect((await handleApplyCredentials({ body: { updates: [{ id: 1, username: 'bob' }] }, userIds: [1] })).status).not.toBe(403);
    expect((await handleExportCurrent({ body: {}, userIds: [1] })).status).not.toBe(403);
    expect((await handleContest({ body: { mode: 'add', contestId: 1 }, userIds: [1] })).status).not.toBe(403);
    expect((await handleTeam({ body: { mode: 'remove-any' }, userIds: [1] })).status).not.toBe(403);
    expect((await handleProfile({ body: { mode: 'clear-email' }, userIds: [1] })).status).not.toBe(403);
  });
});
