import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  ensurePermission: vi.fn(),
  getPermissions: vi.fn(),
  recordAudit: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: { questions: { update: mocks.update } } }));
vi.mock('@/lib/permissions', () => ({
  ensurePermission: mocks.ensurePermission,
  getPermissions: mocks.getPermissions,
}));
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));

import { replyToQuestion } from '@/app/actions/questions';
import { stripDisallowedFields } from '@/lib/field-permissions';

const ANSWER = { reply_subject: 'No Comment/Please refer to task statement', reply_text: '' };

/**
 * The marker that records how a question was answered.
 *
 * Why the field gate is asserted beside the write: a reply that reaches the table without the
 * marker is indistinguishable from one written before the column existed, so a field the
 * permission map does not carry would silently drop the grader's choice.
 */
describe('question resolution marker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensurePermission.mockResolvedValue(undefined);
    mocks.getPermissions.mockResolvedValue(new Set(['question:read', 'question:answer']));
    mocks.update.mockResolvedValue({});
    mocks.recordAudit.mockResolvedValue(undefined);
  });

  it('carries the marker the grader chose into the reply', async () => {
    const result = await replyToQuestion(11, 3, { ...ANSWER, resolution_kind: 'settled_by_statement' });

    expect(result).toEqual({ success: true });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: {
        admin_id: 3,
        reply_subject: ANSWER.reply_subject,
        reply_text: ANSWER.reply_text,
        resolution_kind: 'settled_by_statement',
        reply_timestamp: expect.any(Date),
        ignored: false,
      },
    });
  });

  it('writes no marker when the caller sends none', async () => {
    await replyToQuestion(11, 3, { ...ANSWER, resolution_kind: undefined });

    expect(mocks.update.mock.calls[0][0].data.resolution_kind).toBeUndefined();
  });

  it('refuses the reply when the marker is not an updatable field', async () => {
    mocks.getPermissions.mockResolvedValue(new Set(['question:read']));

    const result = await replyToQuestion(11, 3, { ...ANSWER, resolution_kind: 'settled_by_statement' });

    expect(result).toEqual({ success: false, error: 'Insufficient field permissions' });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('gates the field on question:answer', () => {
    expect(stripDisallowedFields('questions', { resolution_kind: 'settled_by_statement' }, new Set(['question:answer'])))
      .toEqual({ resolution_kind: 'settled_by_statement' });
    expect(stripDisallowedFields('questions', { resolution_kind: 'settled_by_statement' }, new Set(['question:read'])))
      .toEqual({});
  });
});
