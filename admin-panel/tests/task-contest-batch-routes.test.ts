import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const mockAssign = vi.fn();
const mockUpdateWindow = vi.fn();

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/services/tasks', () => ({ assignTaskToContest: (...args: unknown[]) => mockAssign(...args) }));
vi.mock('@/lib/services/contests', () => ({ updateContestWindow: (...args: unknown[]) => mockUpdateWindow(...args) }));

afterEach(() => vi.clearAllMocks());

function makeReq(body: unknown): { json: () => Promise<unknown> } {
  return { json: async () => body };
}

async function loadTasksRoute() {
  vi.resetModules();
  return import('@/app/api/tasks/batch/route');
}

async function loadContestsRoute() {
  vi.resetModules();
  return import('@/app/api/contests/batch/route');
}

function read(rel: string): string {
  return fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf-8');
}

describe('tasks batch route', () => {
  it('assigns each id in order and reports the clean count', async () => {
    mockAssign.mockResolvedValue({ success: true });
    const { POST } = await loadTasksRoute();
    const res = await POST(makeReq({ action: 'assign', taskIds: [3, 1, 2], contestId: 7 }) as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, assignedCount: 3, failed: [], contestId: 7 });
    expect(mockAssign.mock.calls.map(([id]) => id)).toEqual([3, 1, 2]);
    expect(mockAssign.mock.calls.every(([, contestId]) => contestId === 7)).toBe(true);
  });

  it('carries a null contestId through as an unassign', async () => {
    mockAssign.mockResolvedValue({ success: true });
    const { POST } = await loadTasksRoute();
    await POST(makeReq({ action: 'assign', taskIds: [5], contestId: null }) as never);
    expect(mockAssign).toHaveBeenCalledWith(5, null);
  });

  it('keeps going when one task fails and names it', async () => {
    mockAssign.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: false, error: 'Task not found' });
    const { POST } = await loadTasksRoute();
    const res = await POST(makeReq({ action: 'assign', taskIds: [1, 2], contestId: 7 }) as never);
    const body = await res.json();

    expect(body).toMatchObject({ assignedCount: 1, failed: [{ id: 2, reason: 'Task not found' }] });
  });

  it('rejects an empty id list', async () => {
    const { POST } = await loadTasksRoute();
    const res = await POST(makeReq({ action: 'assign', taskIds: [], contestId: 7 }) as never);
    expect(res.status).toBe(400);
    expect(mockAssign).not.toHaveBeenCalled();
  });

  it('rejects an unknown action', async () => {
    const { POST } = await loadTasksRoute();
    const res = await POST(makeReq({ action: 'nope', taskIds: [1], contestId: 7 }) as never);
    expect(res.status).toBe(400);
  });

  it('maps a permission refusal to its own status', async () => {
    mockAssign.mockRejectedValue(Object.assign(new Error('Unauthorized: Missing task:update permission'), { status: 403 }));
    const { POST } = await loadTasksRoute();
    const res = await POST(makeReq({ action: 'assign', taskIds: [1], contestId: 7 }) as never);
    expect(res.status).toBe(403);
  });

  it('reuses the num-aware service rather than writing contest_id directly', () => {
    const src = read('src/app/api/tasks/batch/route.ts');
    expect(src).toContain('taskService.assignTaskToContest');
    expect(src).not.toContain('prisma.tasks.update');
  });
});

describe('contests batch route', () => {
  it('passes only the window fields through to the service', async () => {
    mockUpdateWindow.mockResolvedValue({ success: true });
    const { POST } = await loadContestsRoute();
    const res = await POST(makeReq({
      action: 'update-window',
      contestIds: [1, 2],
      patch: { timezone: 'Asia/Bangkok', allow_registration: true, name: 'ignored', token_max_number: 99 },
    }) as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, updatedCount: 2, failed: [] });
    expect(mockUpdateWindow).toHaveBeenCalledTimes(2);
    expect(mockUpdateWindow.mock.calls[0][1]).toEqual({ timezone: 'Asia/Bangkok', allow_registration: true });
  });

  it('aggregates failures per contest', async () => {
    mockUpdateWindow.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: false, error: 'Contest not found' });
    const { POST } = await loadContestsRoute();
    const res = await POST(makeReq({ action: 'update-window', contestIds: [1, 2], patch: { ip_restriction: false } }) as never);
    const body = await res.json();

    expect(body).toMatchObject({ updatedCount: 1, failed: [{ id: 2, reason: 'Contest not found' }] });
  });

  it('rejects a patch with no window fields', async () => {
    const { POST } = await loadContestsRoute();
    const res = await POST(makeReq({ action: 'update-window', contestIds: [1], patch: { name: 'ignored', token_max_number: 5 } }) as never);
    expect(res.status).toBe(400);
    expect(mockUpdateWindow).not.toHaveBeenCalled();
  });

  it('maps a permission refusal to its own status', async () => {
    mockUpdateWindow.mockRejectedValue(Object.assign(new Error('Unauthorized: Missing contest:update permission'), { status: 403 }));
    const { POST } = await loadContestsRoute();
    const res = await POST(makeReq({ action: 'update-window', contestIds: [1], patch: { timezone: 'UTC' } }) as never);
    expect(res.status).toBe(403);
  });

  it('routes the write through the window service, not the full update', () => {
    const src = read('src/app/api/contests/batch/route.ts');
    expect(src).toContain('contestService.updateContestWindow');
  });
});
