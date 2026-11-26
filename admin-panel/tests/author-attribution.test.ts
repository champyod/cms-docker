import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const mocks = vi.hoisted(() => ({
  createAnnouncement: vi.fn(),
  updateQuestion: vi.fn(),
  createMessage: vi.fn(),
  ensurePermission: vi.fn(),
  getPermissions: vi.fn(),
  recordAudit: vi.fn(),
  revalidatePath: vi.fn(),
  resolveActingAdminId: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    announcements: { create: mocks.createAnnouncement },
    questions: { update: mocks.updateQuestion },
    messages: { create: mocks.createMessage },
  },
}));
vi.mock('@/lib/permissions', () => ({
  ensurePermission: mocks.ensurePermission,
  getPermissions: mocks.getPermissions,
}));
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/lib/server/acting-admin', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/acting-admin')>(
    '@/lib/server/acting-admin',
  );
  return { ...actual, resolveActingAdminId: mocks.resolveActingAdminId };
});

import { createAnnouncement } from '@/app/actions/announcements';
import { replyToQuestion } from '@/app/actions/questions';
import { sendMessage } from '@/app/actions/participations';

/** The text between a function's opening parenthesis and its matching one. */
function parameterList(source: string): string {
  const open = source.indexOf('(');
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '(') depth += 1;
    if (source[index] === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  return source;
}

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf-8');
}

/**
 * The author of a message, a question reply or an announcement.
 *
 * Why the signature is the test and not only the behaviour: an `adminId` parameter is the
 * defect, whether or not a caller currently passes one. A future caller would pass a chosen
 * id and the row would attribute the write to that administrator, so the absence of the
 * parameter is what makes the attribution impossible rather than merely unused.
 */
describe('WS-13 — the acting administrator cannot be chosen by the caller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensurePermission.mockResolvedValue(undefined);
    mocks.getPermissions.mockResolvedValue(
      new Set([
        'announcement:read',
        'announcement:update',
        'question:answer',
        'question:read',
        'message:create',
      ]),
    );
    mocks.createAnnouncement.mockResolvedValue({ id: 1 });
    mocks.updateQuestion.mockResolvedValue({});
    mocks.createMessage.mockResolvedValue({ id: 2 });
    mocks.recordAudit.mockResolvedValue(undefined);
    mocks.resolveActingAdminId.mockResolvedValue(7);
  });

  it('signs an announcement with the session administrator', async () => {
    const result = await createAnnouncement(4, { subject: 'Round 2', text: 'Starts at 9' });

    expect(result).toEqual({ success: true });
    expect(mocks.createAnnouncement.mock.calls[0][0].data.admin_id).toBe(7);
  });

  it('signs a question reply with the session administrator', async () => {
    const result = await replyToQuestion(11, { reply_subject: 'Yes', reply_text: 'See statement' });

    expect(result).toEqual({ success: true });
    expect(mocks.updateQuestion.mock.calls[0][0].data.admin_id).toBe(7);
  });

  it('signs a participation message with the session administrator', async () => {
    const result = await sendMessage(5, { subject: 'Hi', text: 'Welcome' });

    expect(result).toEqual({ success: true });
    expect(mocks.createMessage.mock.calls[0][0].data.admin_id).toBe(7);
  });

  it('refuses every authoring write when no administrator is signed in', async () => {
    mocks.resolveActingAdminId.mockResolvedValue(null);

    await expect(createAnnouncement(4, { subject: 's', text: 't' })).resolves.toEqual({
      success: false,
      error: 'Not authenticated',
    });
    await expect(replyToQuestion(11, { reply_subject: 's', reply_text: 't' })).resolves.toEqual({
      success: false,
      error: 'Not authenticated',
    });
    await expect(sendMessage(5, { subject: 's', text: 't' })).resolves.toEqual({
      success: false,
      error: 'Not authenticated',
    });
    expect(mocks.createAnnouncement).not.toHaveBeenCalled();
    expect(mocks.updateQuestion).not.toHaveBeenCalled();
    expect(mocks.createMessage).not.toHaveBeenCalled();
  });

  it('takes no admin id on any of the three actions', () => {
    for (const [file, action] of [
      ['src/app/actions/announcements.ts', 'createAnnouncement'],
      ['src/app/actions/questions.ts', 'replyToQuestion'],
      ['src/app/actions/participations.ts', 'sendMessage'],
    ] as const) {
      const source = readSource(file);
      const start = source.indexOf(`export async function ${action}(`);
      expect(parameterList(source.slice(start))).not.toContain('adminId');
    }
  });
});
