import { describe, expect, it, vi } from 'vitest';
import { readSubmissionCapabilities } from '@/lib/evaluation-read-model-projections';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/audit', () => ({ recordAudit: vi.fn(async () => undefined) }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));

const RECOMPUTE_KEYS = [
  'submission:recompute',
  'submission:rejudge',
  'evaluation:delete',
  'submissionresult:delete',
];

describe('recompute capability matches the action gates', () => {
  it('hides recompute when any gate key is missing', () => {
    const partial = readSubmissionCapabilities(new Set(['submission:recompute']));
    expect(partial.canRecompute).toBe(false);
  });

  it('shows recompute only with every gate key', () => {
    const full = readSubmissionCapabilities(new Set(RECOMPUTE_KEYS));
    expect(full.canRecompute).toBe(true);
  });
});

describe('recalculateSubmission contains permission failures', () => {
  it('returns failure instead of throwing when a gate key is missing', async () => {
    vi.resetModules();
    vi.doMock('@/lib/permissions', () => ({
      ensurePermission: vi.fn(async (key: string) => {
        if (key === 'evaluation:delete') {
          const { AuthorizationError } = await import('@/lib/server/authorization');
          throw new AuthorizationError(403, 'evaluation:delete');
        }
      }),
      getPermissions: vi.fn(async () => new Set(RECOMPUTE_KEYS)),
    }));
    const { recalculateSubmission } = await import('@/app/actions/submissions');
    const outcome = await recalculateSubmission(1682, 'full');
    expect(outcome.success).toBe(false);
    expect(outcome.error).toMatch(/evaluation:delete/);
  });
});
