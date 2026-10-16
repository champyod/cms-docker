import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AUDIT_POLL_MS, LIVE_HEARTBEAT_MS } from '@/lib/constants/live-stream';
import { nextFrame, toFrame } from './stream-frames';
import type { AuditCursorFrame } from '@/lib/live/frames';

const mocks = vi.hoisted(() => ({
  verifyApiPermission: vi.fn(),
  findFirst: vi.fn(),
}));

vi.mock('@/lib/api-utils', () => ({ verifyApiPermission: mocks.verifyApiPermission }));
vi.mock('@/lib/prisma', () => ({ prisma: { audit_log: { findFirst: mocks.findFirst } } }));

async function openStream(signal?: AbortSignal): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const { GET } = await import('@/app/api/audit/stream/route');
  const request = signal === undefined
    ? new Request('http://panel.local/api/audit/stream')
    : new Request('http://panel.local/api/audit/stream', { signal });
  const response = await GET(request);
  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Type')).toBe('text/event-stream');
  return (response.body as ReadableStream<Uint8Array>).getReader();
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.verifyApiPermission.mockReset();
  mocks.verifyApiPermission.mockResolvedValue({ authorized: true, session: { userId: '1' } });
  mocks.findFirst.mockReset();
  mocks.findFirst.mockResolvedValue({ id: BigInt(7) });
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * The audit log's cursor stream: the page reloads its own query when a row lands, so what travels here
 * is only the newest row id.
 */
describe('audit stream', () => {
  it('opens with the newest row id and sends nothing while it stands still', async () => {
    const reader = await openStream();

    const opening = await nextFrame(reader);
    expect(toFrame<AuditCursorFrame>(opening as string)).toEqual({ latestId: '7' });

    await vi.advanceTimersByTimeAsync(AUDIT_POLL_MS);
    expect(mocks.findFirst.mock.calls.length).toBeGreaterThan(1);
    expect(await nextFrame(reader)).toBeNull();

    await reader.cancel();
  });

  it('sends the id as soon as a row lands', async () => {
    const reader = await openStream();
    await nextFrame(reader);

    mocks.findFirst.mockResolvedValue({ id: BigInt(8) });
    await vi.advanceTimersByTimeAsync(AUDIT_POLL_MS);
    expect(toFrame<AuditCursorFrame>((await nextFrame(reader)) as string)).toEqual({ latestId: '8' });

    await reader.cancel();
  });

  it('restates the cursor on the heartbeat so the table can tell a quiet log from a dead one', async () => {
    const reader = await openStream();
    await nextFrame(reader);

    await vi.advanceTimersByTimeAsync(LIVE_HEARTBEAT_MS);
    expect(toFrame<AuditCursorFrame>((await nextFrame(reader)) as string)).toEqual({ latestId: '7' });

    await reader.cancel();
  });

  it('reports an empty log as a null cursor rather than as a row', async () => {
    mocks.findFirst.mockResolvedValue(null);
    const reader = await openStream();
    expect(toFrame<AuditCursorFrame>((await nextFrame(reader)) as string)).toEqual({ latestId: null });
    await reader.cancel();
  });

  it('closes the connection on abort, taking its polling with it', async () => {
    const abort = new AbortController();
    const reader = await openStream(abort.signal);

    const opening = await reader.read();
    const openingPayload = JSON.parse(new TextDecoder().decode(opening.value).replace(/^data: /, '').trim()) as { readAt: string; frame: AuditCursorFrame };
    // Why the read instant is asserted instead of ignored: the freshness cue dates every row from it,
    // so a frame the server sent without one would leave rows the panel could not compare.
    expect(openingPayload.frame).toEqual({ latestId: '7' });
    expect(Number.isNaN(Date.parse(openingPayload.readAt))).toBe(false);

    abort.abort();
    expect(await reader.read()).toEqual({ done: true, value: undefined });
    // Why the flush: the source's teardown is handed back one microtask after its first frame, and a
    // disconnect can land in between.
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('refuses a viewer without the audit page permissions, and never reads the log for them', async () => {
    mocks.verifyApiPermission.mockResolvedValue({ authorized: false, response: new Response('nope', { status: 403 }) });
    const { GET } = await import('@/app/api/audit/stream/route');

    const response = await GET(new Request('http://panel.local/api/audit/stream'));
    expect(response.status).toBe(403);
    expect(mocks.verifyApiPermission.mock.calls.map(([key]) => key)).toEqual(['audit:list']);
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });
});
