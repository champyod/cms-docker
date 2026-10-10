import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The resolve action is the only place a conflict resolution becomes a write, so
 * docker is replaced here and nothing a test drives depends on a container. What
 * is left is the part worth asserting: which requests are refused before any
 * statement is built, and which statement each resolution becomes.
 */
const harness = vi.hoisted(() => ({
  dockerCalls: [] as string[][],
  edgesOutput: '',
}));

vi.mock('@/lib/permissions', () => ({ ensurePermission: async () => undefined }));

vi.mock('@/app/actions/restore-preview-run', () => ({
  describeFailure: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  runDocker: vi.fn(async (args: string[]) => {
    harness.dockerCalls.push(args);
    if (args.includes('true')) return '';
    if (args.some((argument) => argument.includes('pg_constraint'))) return harness.edgesOutput;
    return '';
  }),
  settle: async (work: Promise<unknown>) => {
    try {
      return { ok: true, value: await work };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
}));

import { runDocker } from '@/app/actions/restore-preview-run';
import { resolvePreviewConflict } from '@/app/actions/restore-apply-resolve';
import type { ResolveConflictInput } from '@/app/actions/restore-apply-resolve';

const PREVIEW_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

function input(overrides: Partial<ResolveConflictInput> = {}): ResolveConflictInput {
  return {
    previewId: PREVIEW_ID,
    table: 'admins',
    keyValues: ['7'],
    resolution: { action: 'keep-live' },
    ...overrides,
  };
}

/** The statement the action sent, if it sent one at all. */
function sentBatch(): string {
  return harness.dockerCalls.flat().find((argument) => argument.startsWith('BEGIN')) ?? '';
}

beforeEach(() => {
  harness.dockerCalls = [];
  harness.edgesOutput = '';
  vi.mocked(runDocker).mockClear();
});

describe('requests refused before anything is written', () => {
  it('refuses an unknown preview id', async () => {
    const result = await resolvePreviewConflict(input({ previewId: '../../etc' }));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Unknown preview id/);
    expect(harness.dockerCalls).toEqual([]);
  });

  it('refuses a table outside the catalog', async () => {
    const result = await resolvePreviewConflict(input({ table: 'audit_log' }));
    expect(result.error).toMatch(/not in the backup table catalog/);
    expect(harness.dockerCalls).toEqual([]);
  });

  it('refuses an archive row key whose length does not match the catalog key, without being told the columns', async () => {
    const result = await resolvePreviewConflict(input({ keyValues: [] }));
    expect(result.error).toMatch(/identified by id, so its key needs 1 value\(s\) and 0 arrived/);
    expect(harness.dockerCalls).toEqual([]);
  });

  it('refuses a composite-key row identified by one value', async () => {
    const result = await resolvePreviewConflict(input({ table: 'submission_results', keyValues: ['4'] }));
    expect(result.error).toMatch(/identified by submission_id, dataset_id/);
    expect(harness.dockerCalls).toEqual([]);
  });

  it('refuses a take-archive without the live row key', async () => {
    const result = await resolvePreviewConflict(input({ resolution: { action: 'take-archive', toValues: [] } }));
    expect(result.error).toMatch(/live row key is incomplete/);
    expect(harness.dockerCalls).toEqual([]);
  });

  it('refuses an autogenerate with no value', async () => {
    const result = await resolvePreviewConflict(input({ resolution: { action: 'autogenerate', column: 'username', value: '' } }));
    expect(result.error).toMatch(/generated value is required/);
    expect(harness.dockerCalls).toEqual([]);
  });

  it('reports a scratch container that is gone', async () => {
    vi.mocked(runDocker).mockRejectedValueOnce(new Error('No such container'));
    const result = await resolvePreviewConflict(input());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/is gone/);
    expect(sentBatch()).toBe('');
  });
});

describe('keep-live', () => {
  it('drops the archive row, with the failure of a statement made fatal', async () => {
    const result = await resolvePreviewConflict(input());
    expect(result.success).toBe(true);
    expect(sentBatch()).toContain('DELETE FROM "public"."admins" WHERE "id" = \'7\'');
    expect(sentBatch()).toContain('SET LOCAL session_replication_role = replica');
    expect(harness.dockerCalls.flat()).toContain('ON_ERROR_STOP=1');
  });
});

describe('take-archive', () => {
  it('names the archive row and follows the rows pointing at it', async () => {
    harness.edgesOutput = ['admin_groups_admin_id_fkey\tadmin_groups\tadmin_id\tadmins\tid', 'messages_admin_id_fkey\tmessages\tadmin_id\tadmins\tid'].join('\n');
    const result = await resolvePreviewConflict(input({ resolution: { action: 'take-archive', toValues: ['1'] } }));
    expect(result.success).toBe(true);
    expect(sentBatch()).toContain('UPDATE "public"."admins" SET "id" = \'1\' WHERE "id" = \'7\'');
    expect(sentBatch()).toContain('UPDATE "public"."admin_groups" SET "admin_id" = \'1\' WHERE "admin_id" = \'7\'');
    expect(sentBatch()).toContain('UPDATE "public"."messages" SET "admin_id" = \'1\' WHERE "admin_id" = \'7\'');
  });

  it('rewrites the archive row alone when nothing points at it', async () => {
    const result = await resolvePreviewConflict(input({ resolution: { action: 'take-archive', toValues: ['1'] } }));
    expect(result.success).toBe(true);
    expect(sentBatch()).toContain('UPDATE "public"."admins" SET "id" = \'1\' WHERE "id" = \'7\'');
    expect(sentBatch()).not.toContain('admin_groups');
  });
});

describe('autogenerate', () => {
  it('rewrites the one value on the archive row', async () => {
    const result = await resolvePreviewConflict(input({ resolution: { action: 'autogenerate', column: 'username', value: 'ada-restored' } }));
    expect(result.success).toBe(true);
    expect(sentBatch()).toContain('UPDATE "public"."admins" SET "username" = \'ada-restored\' WHERE "id" = \'7\'');
  });

  it('escapes an apostrophe in the generated value', async () => {
    await resolvePreviewConflict(input({ resolution: { action: 'autogenerate', column: 'username', value: "o'brien" } }));
    expect(sentBatch()).toContain("'o''brien'");
  });
});

describe('the composite-key case', () => {
  it('identifies a row by its whole catalog key', async () => {
    const result = await resolvePreviewConflict(input({ table: 'submission_results', keyValues: ['4', '9'] }));
    expect(result.success).toBe(true);
    expect(sentBatch()).toContain('DELETE FROM "public"."submission_results" WHERE ("submission_id", "dataset_id") = (\'4\', \'9\')');
  });
});
