import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  findFirst: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: { questions: { count: mocks.count, findFirst: mocks.findFirst } } }));

/**
 * The reader behind the header's question signal.
 *
 * Why the mapping is worth its own test: the frame the header toasts carries a name and an ISO
 * timestamp taken from a row shape the route never sees, and a change there would show as a broken
 * description rather than as a failure.
 */
describe('unanswered questions reader', () => {
  beforeEach(() => {
    mocks.count.mockReset();
    mocks.count.mockResolvedValue(2);
    mocks.findFirst.mockReset();
    mocks.findFirst.mockResolvedValue({
      id: 11,
      subject: 'Is the round unrated?',
      question_timestamp: new Date('2026-10-13T09:30:00.000Z'),
      participations: { users: { username: 'ada' } },
    });
  });

  it('answers with the count and the newest question in the frame shape', async () => {
    const { readUnansweredQuestions } = await import('@/lib/questions-reader');
    expect(await readUnansweredQuestions()).toEqual({
      unansweredCount: 2,
      latest: { id: 11, subject: 'Is the round unrated?', username: 'ada', askedAt: '2026-10-13T09:30:00.000Z' },
    });
  });

  it('asks only for unanswered questions', async () => {
    const { readUnansweredQuestions } = await import('@/lib/questions-reader');
    await readUnansweredQuestions();
    expect(mocks.count).toHaveBeenCalledWith({ where: { reply_timestamp: null, ignored: false } });
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { reply_timestamp: null, ignored: false },
      orderBy: { question_timestamp: 'desc' },
    }));
  });

  it('answers with a null newest question when nothing is waiting', async () => {
    mocks.count.mockResolvedValue(0);
    mocks.findFirst.mockResolvedValue(null);
    const { readUnansweredQuestions } = await import('@/lib/questions-reader');
    expect(await readUnansweredQuestions()).toEqual({ unansweredCount: 0, latest: null });
  });
});
