import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEPLOY_HEARTBEAT_MS, DEPLOY_IDLE_TIMEOUT_MS, DEPLOY_WALL_TIMEOUT_MS } from '@/lib/constants/deploy';
import { GET } from '@/app/api/deploy/status/[operationId]/route';

/**
 * The watch's side of a deploy: what the panel tells the browser while the operation runs.
 *
 * Why only setInterval/clearInterval/Date are faked: the route's watch is a clock, and the test drives
 * that clock; leaving real timers alone lets a stuck stream fail with a message instead of hanging.
 */
const mocks = vi.hoisted(() => ({
  verifyApiPermission: vi.fn(),
  fetchDeployStatus: vi.fn(),
}));

vi.mock('@/lib/api-utils', () => ({ verifyApiPermission: mocks.verifyApiPermission }));
vi.mock('@/lib/deploy-store', () => ({ fetchDeployStatus: mocks.fetchDeployStatus }));

const OPERATION_ID = '0123456789abcdef';
const LOG = 'Step 1/3 : FROM ubuntu:24.04';

let startedAt: string;

const running = (): unknown => ({
  success: true,
  status: 'running',
  contestId: 12,
  startedAt,
  log: LOG,
  percent: 12,
});

interface Frame {
  status: string;
  log: string;
  error?: string;
  warning?: string;
  success: boolean;
}

async function openStream(): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const response = await GET(
    new Request(`http://panel.local/api/deploy/status/${OPERATION_ID}`),
    { params: Promise.resolve({ operationId: OPERATION_ID }) },
  );
  expect(response.status).toBe(200);
  return (response.body as ReadableStream<Uint8Array>).getReader();
}

function toFrame(raw: string): Frame {
  return JSON.parse(raw.replace(/^data: /, '').trim()) as Frame;
}

/** Reads one frame, failing on a stream that ended instead of producing one. */
async function readFrame(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const next = await reader.read();
  expect(next.done).toBe(false);
  return new TextDecoder().decode(next.value);
}

/** Reads until the stream closes, so a watch that never ends fails here rather than in a timeout. */
async function drain(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string[]> {
  const frames: string[] = [];
  const deadline = new Promise<'deadline'>((resolve) => { setTimeout(() => resolve('deadline'), 2000); });
  for (;;) {
    const next = await Promise.race([reader.read(), deadline]);
    if (next === 'deadline') throw new Error(`the stream stayed open after ${frames.length} frames`);
    if (next.done) return frames;
    frames.push(new TextDecoder().decode(next.value, { stream: true }));
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  startedAt = new Date().toISOString();
  mocks.verifyApiPermission.mockReset();
  mocks.verifyApiPermission.mockResolvedValue({ authorized: true, session: { userId: 1 } });
  mocks.fetchDeployStatus.mockReset();
  mocks.fetchDeployStatus.mockResolvedValue(running());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('deploy status watch', () => {
  it('keeps a quiet build watched, on frames the client can actually receive', async () => {
    const reader = await openStream();
    await vi.advanceTimersByTimeAsync(0);

    const first = await readFrame(reader);
    // Not an SSE comment: a comment never reaches the client's onmessage, so it could not hold the
    // watchdog open — which is how a silent docker build step used to look like a dead connection.
    expect(first.startsWith('data: ')).toBe(true);
    expect(toFrame(first)).toMatchObject({ status: 'running', log: LOG });

    await vi.advanceTimersByTimeAsync(DEPLOY_HEARTBEAT_MS);
    const heartbeat = await readFrame(reader);
    expect(heartbeat.startsWith('data: ')).toBe(true);
    expect(toFrame(heartbeat)).toMatchObject({ status: 'running', log: LOG });

    // Nothing has been appended to the log for longer than the idle window; the deploy is still
    // working, so the watch is still running and still delivering frames.
    await vi.advanceTimersByTimeAsync(DEPLOY_IDLE_TIMEOUT_MS);
    const afterIdle = await readFrame(reader);
    expect(toFrame(afterIdle)).toMatchObject({ status: 'running' });

    // The watch ends at its absolute ceiling, and it says so: the deploy continues in the background,
    // so the frame carries no error — the panel's copy for a 'timeout' is what explains it.
    await vi.advanceTimersByTimeAsync(DEPLOY_WALL_TIMEOUT_MS);
    const frames = await drain(reader);

    const released = toFrame(frames[frames.length - 1]);
    expect(released).toMatchObject({ status: 'timeout', success: false });
    expect(released.error).toBeUndefined();
    expect(released.warning).toBeUndefined();
    expect(released.log).toBe(LOG);
    expect(frames.slice(0, -1).map(toFrame).every((frame) => frame.status === 'running')).toBe(true);
    expect(frames.some((frame) => frame.startsWith(':'))).toBe(false);
    // The watch kept asking: the ceiling was reached by polling, not by an early exit.
    expect(mocks.fetchDeployStatus.mock.calls.length).toBeGreaterThan(10);
  });

  it('ends the watch on a terminal result and reports it', async () => {
    mocks.fetchDeployStatus.mockResolvedValue({
      success: true,
      status: 'completed',
      contestId: 12,
      startedAt,
      log: 'done',
      percent: null,
    });

    const reader = await openStream();
    await vi.advanceTimersByTimeAsync(0);

    const frames = await drain(reader);
    expect(frames).toHaveLength(1);
    expect(toFrame(frames[0])).toMatchObject({ status: 'completed', log: 'done' });
  });
});
