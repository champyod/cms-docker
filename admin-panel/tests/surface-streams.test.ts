import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEPLOY_WORKERS_POLL_MS, LIST_CURSOR_POLL_MS, LIVE_HEARTBEAT_MS } from '@/lib/constants/live-stream';
import type { CursorFrame, WorkersFrame } from '@/lib/live/frames';
import type { WorkerNodeView } from '@/lib/worker-nodes';
import { framesWithin, nextFrame, toFrame } from './stream-frames';

const mocks = vi.hoisted(() => ({
  verifyApiPermission: vi.fn(),
  auditFindFirst: vi.fn(),
  submissionsFindFirst: vi.fn(),
  subchangesCount: vi.fn(),
  collectWorkerStats: vi.fn(),
}));

vi.mock('@/lib/api-utils', () => ({ verifyApiPermission: mocks.verifyApiPermission }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    audit_log: { findFirst: mocks.auditFindFirst },
    submissions: { findFirst: mocks.submissionsFindFirst },
    ranking_subchanges: { count: mocks.subchangesCount },
  },
}));
vi.mock('@/lib/worker-stats', () => ({ collectWorkerStats: mocks.collectWorkerStats }));

type RouteModule = () => Promise<{ GET: (request: Request) => Promise<Response> }>;

async function openStream(load: RouteModule, path: string): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const { GET } = await load();
  const response = await GET(new Request(`http://panel.local${path}`));
  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Type')).toBe('text/event-stream');
  return (response.body as ReadableStream<Uint8Array>).getReader();
}

/** The last frame of a window; a window that crossed a heartbeat ends on the sample, not the restate. */
async function lastFrame(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const frames = await framesWithin(reader);
  return frames[frames.length - 1] as string;
}

function worker(): WorkerNodeView {
  return {
    id: 'worker-0',
    host: 'cms-worker-0',
    port: 26000,
    shard: 0,
    endpoint: 'cms-worker-0:26000',
    connection: 'connected',
    state: 'running',
    health: 'healthy',
    activity: 'idle',
    reachable: true,
    tasks: 0,
    load: 0,
    lagging: false,
    contest: null,
    uptime: '',
    restarts: 0,
    lastLog: '',
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.verifyApiPermission.mockReset();
  mocks.verifyApiPermission.mockResolvedValue({ authorized: true, session: { userId: '1' } });
  mocks.auditFindFirst.mockReset();
  mocks.auditFindFirst.mockResolvedValue({ id: BigInt(11) });
  mocks.submissionsFindFirst.mockReset();
  mocks.submissionsFindFirst.mockResolvedValue({ id: 42 });
  mocks.subchangesCount.mockReset();
  mocks.subchangesCount.mockResolvedValue(3);
  mocks.collectWorkerStats.mockReset();
  mocks.collectWorkerStats.mockResolvedValue([worker()]);
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * The list surfaces the shared live layer grew on: each route publishes the cursor only its own
 * surface can read, and the panel re-reads its query when that cursor moves.
 */
describe('users and teams list streams', () => {
  it('cursors the users list on the newest audited user write', async () => {
    const reader = await openStream(() => import('@/app/api/users/stream/route'), '/api/users/stream');

    expect(toFrame<CursorFrame>((await nextFrame(reader)) as string)).toEqual({ cursor: '11' });
    expect(mocks.auditFindFirst.mock.calls[0][0].where).toEqual({ entity: 'user' });

    await vi.advanceTimersByTimeAsync(LIST_CURSOR_POLL_MS);
    expect(await nextFrame(reader)).toBeNull();

    mocks.auditFindFirst.mockResolvedValue({ id: BigInt(12) });
    await vi.advanceTimersByTimeAsync(LIST_CURSOR_POLL_MS);
    expect(toFrame<CursorFrame>(await lastFrame(reader))).toEqual({ cursor: '12' });

    await reader.cancel();
  });

  it('cursors the teams list on the newest audited team write', async () => {
    const reader = await openStream(() => import('@/app/api/teams/stream/route'), '/api/teams/stream');

    expect(toFrame<CursorFrame>((await nextFrame(reader)) as string)).toEqual({ cursor: '11' });
    expect(mocks.auditFindFirst.mock.calls[0][0].where).toEqual({ entity: 'team' });

    await reader.cancel();
  });

  it('reports an entity with no audit row as a null cursor rather than as an id', async () => {
    mocks.auditFindFirst.mockResolvedValue(null);
    const reader = await openStream(() => import('@/app/api/users/stream/route'), '/api/users/stream');
    expect(toFrame<CursorFrame>((await nextFrame(reader)) as string)).toEqual({ cursor: null });
    await reader.cancel();
  });

  it('restates the cursor on the heartbeat so a quiet list is told apart from a dead stream', async () => {
    const reader = await openStream(() => import('@/app/api/users/stream/route'), '/api/users/stream');
    await nextFrame(reader);

    await vi.advanceTimersByTimeAsync(LIVE_HEARTBEAT_MS);
    expect(toFrame<CursorFrame>(await lastFrame(reader))).toEqual({ cursor: '11' });

    await reader.cancel();
  });

  it('refuses a viewer without user:list, and never reads the log for them', async () => {
    mocks.verifyApiPermission.mockResolvedValue({ authorized: false, response: new Response('nope', { status: 403 }) });
    const { GET } = await import('@/app/api/users/stream/route');

    const response = await GET(new Request('http://panel.local/api/users/stream'));
    expect(response.status).toBe(403);
    expect(mocks.verifyApiPermission.mock.calls.map(([key]) => key)).toEqual(['user:list']);
    expect(mocks.auditFindFirst).not.toHaveBeenCalled();
  });

  it('refuses a viewer without team:list on the team route', async () => {
    mocks.verifyApiPermission.mockResolvedValue({ authorized: false, response: new Response('nope', { status: 403 }) });
    const { GET } = await import('@/app/api/teams/stream/route');

    const response = await GET(new Request('http://panel.local/api/teams/stream'));
    expect(response.status).toBe(403);
    expect(mocks.verifyApiPermission.mock.calls.map(([key]) => key)).toEqual(['team:list']);
  });
});

describe('evaluation lanes stream', () => {
  it('cursors the board on the newest lane verb and the newest submission', async () => {
    const reader = await openStream(() => import('@/app/api/evaluation/lanes/stream/route'), '/api/evaluation/lanes/stream');

    expect(toFrame<CursorFrame>((await nextFrame(reader)) as string)).toEqual({ cursor: '11:42' });
    expect(mocks.auditFindFirst.mock.calls[0][0].where.entity).toBe('submission');

    // A new arrival moves the waiting counts a card shows, and no lane verb records it.
    mocks.submissionsFindFirst.mockResolvedValue({ id: 43 });
    await vi.advanceTimersByTimeAsync(LIST_CURSOR_POLL_MS);
    expect(toFrame<CursorFrame>(await lastFrame(reader))).toEqual({ cursor: '11:43' });

    await reader.cancel();
  });

  it('refuses a viewer without evaluation:list', async () => {
    mocks.verifyApiPermission.mockResolvedValue({ authorized: false, response: new Response('nope', { status: 403 }) });
    const { GET } = await import('@/app/api/evaluation/lanes/stream/route');

    const response = await GET(new Request('http://panel.local/api/evaluation/lanes/stream'));
    expect(response.status).toBe(403);
    expect(mocks.verifyApiPermission.mock.calls.map(([key]) => key)).toEqual(['evaluation:list']);
    expect(mocks.submissionsFindFirst).not.toHaveBeenCalled();
  });
});

describe('deployments workers stream', () => {
  it('sends every node reading, and only when a reading moves', async () => {
    const reader = await openStream(() => import('@/app/api/workers/stream/route'), '/api/workers/stream');

    expect(toFrame<WorkersFrame>((await nextFrame(reader)) as string)).toEqual({ workers: [worker()] });

    await vi.advanceTimersByTimeAsync(DEPLOY_WORKERS_POLL_MS);
    expect(mocks.collectWorkerStats.mock.calls.length).toBeGreaterThan(1);
    // The window crossed the heartbeat, so every frame in it is that same reading restated.
    for (const frame of await framesWithin(reader)) {
      expect(toFrame<WorkersFrame>(frame)).toEqual({ workers: [worker()] });
    }

    mocks.collectWorkerStats.mockResolvedValue([{ ...worker(), activity: 'evaluating' }]);
    await vi.advanceTimersByTimeAsync(DEPLOY_WORKERS_POLL_MS);
    expect(toFrame<WorkersFrame>(await lastFrame(reader))).toEqual({
      workers: [{ ...worker(), activity: 'evaluating' }],
    });

    await reader.cancel();
  });

  it('refuses a viewer without task:read, and never probes the fleet for them', async () => {
    mocks.verifyApiPermission.mockResolvedValue({ authorized: false, response: new Response('nope', { status: 403 }) });
    const { GET } = await import('@/app/api/workers/stream/route');

    const response = await GET(new Request('http://panel.local/api/workers/stream'));
    expect(response.status).toBe(403);
    expect(mocks.verifyApiPermission.mock.calls.map(([key]) => key)).toEqual(['task:read']);
    expect(mocks.collectWorkerStats).not.toHaveBeenCalled();
  });
});

describe('ranking board stream', () => {
  it('cursors the board on the audited ranking write, the newest submission and the subchange count', async () => {
    const reader = await openStream(() => import('@/app/api/ranking/stream/route'), '/api/ranking/stream');

    expect(toFrame<CursorFrame>((await nextFrame(reader)) as string)).toEqual({ cursor: '11:42:3' });

    // A score applied to a key the projection did not hold before is the ordinary case.
    mocks.subchangesCount.mockResolvedValue(4);
    await vi.advanceTimersByTimeAsync(LIST_CURSOR_POLL_MS);
    expect(toFrame<CursorFrame>(await lastFrame(reader))).toEqual({ cursor: '11:42:4' });

    await reader.cancel();
  });

  it('checks both board keys before handing the source its session', async () => {
    const reader = await openStream(() => import('@/app/api/ranking/stream/route'), '/api/ranking/stream');
    expect(mocks.verifyApiPermission.mock.calls.map(([key]) => key)).toEqual(['ranking:list', 'ranking:read']);
    await reader.cancel();
  });
});
