import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The waiver write as the panel performs it: the server action, not the module underneath.
 *
 * WHY through the action: the module test proves `createWaiver` refuses a missing date; this proves
 * the surface an operator actually reaches refuses it too, and that the refusal happens before any
 * row is written and without needing `patching:waive` to be re-checked by hand.
 */
describe('createPatchingWaiver', () => {
  const keys: string[] = [];
  const created: Record<string, unknown>[] = [];
  const refusedKeys = new Set<string>();

  beforeEach(() => {
    vi.resetModules();
    keys.length = 0;
    created.length = 0;
    refusedKeys.clear();

    vi.doMock('@/lib/permissions', () => ({
      ensurePermission: vi.fn(async (key: string) => {
        keys.push(key);
        if (refusedKeys.has(key)) throw new Error(`Forbidden: Missing ${key} permission`);
      }),
    }));
    vi.doMock('@/app/actions/auth', () => ({
      getCurrentUser: vi.fn(async () => ({ id: 7, name: 'Operator', username: 'root' })),
    }));
    vi.doMock('next/cache', () => ({ revalidatePath: vi.fn() }));
    vi.doMock('@/lib/audit', () => ({ recordAudit: vi.fn(async () => undefined) }));
    vi.doMock('@/lib/prisma', () => ({
      prisma: {
        security_waivers: {
          create: vi.fn(async (args: { data: Record<string, unknown> }) => {
            created.push(args.data);
            return { id: 51 };
          }),
        },
      },
    }));
  });

  async function action(): Promise<typeof import('@/app/actions/securityPatching')> {
    return import('@/app/actions/securityPatching');
  }

  it('refuses a waiver with no review date, before it writes anything', async () => {
    const { createPatchingWaiver } = await action();

    const result = await createPatchingWaiver({
      source: 'osv',
      match: 'GHSA-vfj7-8cjw-p6xm',
      reason: 'no fixed release',
      reviewBy: '',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('review_by must be a future date');
    expect(created).toEqual([]);
  });

  it('refuses a review date that has already passed', async () => {
    const { createPatchingWaiver } = await action();

    const result = await createPatchingWaiver({
      source: 'rootfs',
      match: 'CVE-2026-1',
      reason: 'accepted',
      reviewBy: '2020-01-01',
    });

    expect(result.success).toBe(false);
    expect(created).toEqual([]);
  });

  it('records what it covers, why, who and when', async () => {
    const { createPatchingWaiver } = await action();

    const result = await createPatchingWaiver({
      source: 'rootfs',
      match: 'CVE-2026-78669',
      reason: 'no Compose release carries the patched Go yet',
      reviewBy: '2099-01-31',
    });

    expect(result).toEqual({ success: true, id: 51 });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      source: 'rootfs',
      match: 'CVE-2026-78669',
      reason: 'no Compose release carries the patched Go yet',
      created_by: 7,
    });
    expect(created[0].review_by).toBeInstanceOf(Date);
  });

  it('demands patching:waive as well as the read key, and writes nothing without it', async () => {
    refusedKeys.add('patching:waive');
    const { createPatchingWaiver } = await action();

    await expect(
      createPatchingWaiver({
        source: 'rootfs',
        match: 'CVE-2026-1',
        reason: 'accepted',
        reviewBy: '2099-01-31',
      }),
    ).rejects.toThrow(/patching:waive/);

    expect(keys).toEqual(['security:read', 'patching:waive']);
    expect(created).toEqual([]);
  });
});
