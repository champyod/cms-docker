import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  updateContestLimits: vi.fn(),
  updateContestWindow: vi.fn(),
  updateTaskLimits: vi.fn(),
  assignTaskToContest: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/lib/services/contests', () => ({
  updateContestLimits: mocks.updateContestLimits,
  updateContestWindow: mocks.updateContestWindow,
}));
vi.mock('@/lib/services/tasks', () => ({
  updateTaskLimits: mocks.updateTaskLimits,
  assignTaskToContest: mocks.assignTaskToContest,
}));

function makeReq(body: unknown): { json: () => Promise<unknown> } {
  return { json: async () => body };
}

async function contestsPost(body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const { POST } = await import('@/app/api/contests/batch/route');
  const response = await POST(makeReq(body) as never);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function tasksPost(body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const { POST } = await import('@/app/api/tasks/batch/route');
  const response = await POST(makeReq(body) as never);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateContestLimits.mockResolvedValue({ success: true });
  mocks.updateContestWindow.mockResolvedValue({ success: true });
  mocks.updateTaskLimits.mockResolvedValue({ success: true });
  mocks.assignTaskToContest.mockResolvedValue({ success: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('the contests batch update-limits action', () => {
  it('refuses an empty contest id list', async () => {
    const result = await contestsPost({ action: 'update-limits', contestIds: [], patch: { max_submission_number: 5 } });

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('contestIds is required');
    expect(mocks.updateContestLimits).not.toHaveBeenCalled();
  });

  it('refuses a patch that names no limit field', async () => {
    const result = await contestsPost({ action: 'update-limits', contestIds: [1], patch: { name: 'Autumn', start: '2026-01-01' } });

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('No limit fields in patch');
    expect(mocks.updateContestLimits).not.toHaveBeenCalled();
  });

  it('refuses a patch that is absent altogether', async () => {
    const result = await contestsPost({ action: 'update-limits', contestIds: [1] });

    expect(result.status).toBe(400);
    expect(mocks.updateContestLimits).not.toHaveBeenCalled();
  });

  it('sends only whitelisted, normalised fields and keeps the shape of the response', async () => {
    const result = await contestsPost({
      action: 'update-limits',
      contestIds: [3, 4],
      patch: { max_submission_number: 0, min_submission_interval: 90, name: 'ignored', description: 'ignored too' },
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ success: true, updatedCount: 2, failed: [] });
    expect(mocks.updateContestLimits).toHaveBeenCalledTimes(2);
    expect(mocks.updateContestLimits).toHaveBeenNthCalledWith(1, 3, { max_submission_number: null, min_submission_interval: 90 });
    expect(mocks.updateContestLimits).toHaveBeenNthCalledWith(2, 4, { max_submission_number: null, min_submission_interval: 90 });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/[locale]/contests', 'page');
  });

  it('keeps the successes and names the contests that refused', async () => {
    mocks.updateContestLimits
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, error: 'Contest not found' });

    const result = await contestsPost({ action: 'update-limits', contestIds: [1, 2], patch: { token_gen_max: 5 } });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ success: true, updatedCount: 1, failed: [{ id: 2, reason: 'Contest not found' }] });
  });

  it('leaves the window action on its own whitelist', async () => {
    const result = await contestsPost({ action: 'update-window', contestIds: [1], patch: { timezone: 'UTC' } });

    expect(result.status).toBe(200);
    expect(mocks.updateContestWindow).toHaveBeenCalledWith(1, { timezone: 'UTC' });
    expect(mocks.updateContestLimits).not.toHaveBeenCalled();
  });
});

describe('the tasks batch update-limits action', () => {
  it('refuses an empty task id list', async () => {
    const result = await tasksPost({ action: 'update-limits', taskIds: [], patch: { max_submission_number: 5 } });

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('taskIds is required');
    expect(mocks.updateTaskLimits).not.toHaveBeenCalled();
  });

  it('refuses a patch that names no limit field', async () => {
    const result = await tasksPost({ action: 'update-limits', taskIds: [1], patch: { title: 'Sum' } });

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('No limit fields in patch');
    expect(mocks.updateTaskLimits).not.toHaveBeenCalled();
  });

  it('sends only whitelisted, normalised fields and keeps the shape of the response', async () => {
    const result = await tasksPost({
      action: 'update-limits',
      taskIds: [8],
      patch: { max_user_test_number: 0, token_max_number: 12, max_submission_number: 'not a limit' },
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ success: true, updatedCount: 1, failed: [] });
    // A non-numeric value is not a limit, so the shared rule reads it as a clear.
    expect(mocks.updateTaskLimits).toHaveBeenCalledWith(8, {
      max_user_test_number: null,
      token_max_number: 12,
      max_submission_number: null,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/[locale]/tasks', 'page');
  });

  it('keeps the successes and names the tasks that refused', async () => {
    mocks.updateTaskLimits
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, error: 'Task not found' })
      .mockResolvedValueOnce({ success: false, error: 'Nope' });

    const result = await tasksPost({ action: 'update-limits', taskIds: [1, 2, 3], patch: { min_submission_interval: null } });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      success: true,
      updatedCount: 1,
      failed: [
        { id: 2, reason: 'Task not found' },
        { id: 3, reason: 'Nope' },
      ],
    });
  });

  it('still refuses an invalid action', async () => {
    const result = await tasksPost({ action: 'delete-everything', taskIds: [1], patch: {} });

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('Invalid action');
  });
});

describe('the batch routes never write SQL themselves', () => {
  it('goes through the service functions for both kinds', () => {
    const base = fileURLToPath(new URL('../src/app/api', import.meta.url));
    const contestsRoute = readFileSync(`${base}/contests/batch/route.ts`, 'utf8');
    const tasksRoute = readFileSync(`${base}/tasks/batch/route.ts`, 'utf8');

    for (const source of [contestsRoute, tasksRoute]) {
      expect(source).toContain('pickLimitPatch');
      expect(source).not.toContain('prisma');
      expect(source).not.toContain('$executeRaw');
      expect(source).not.toContain('FROM ');
      expect(source).not.toContain('UPDATE ');
    }
    // One per-target call, so the permission gate and the audit row stay in the service.
    expect(contestsRoute).toContain('contestService.updateContestLimits');
    expect(tasksRoute).toContain('taskService.updateTaskLimits');
  });
});
