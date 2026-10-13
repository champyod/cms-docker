import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LIVE_HEARTBEAT_MS } from '@/lib/constants/live-stream';
import { createLiveStreamRoute, type LiveConnection } from '@/lib/live/stream-route';
import type { PermissionKey } from '@/lib/permissions';
import { nextFrame } from './stream-frames';

const mocks = vi.hoisted(() => ({ verifyApiPermission: vi.fn() }));

vi.mock('@/lib/api-utils', () => ({ verifyApiPermission: mocks.verifyApiPermission }));

/**
 * The shared SSE route builder: the gate, the frame shape, the heartbeat and the cleanup every stream
 * inherits.
 *
 * Why the source is left open: these tests are about the connection's own behaviour, so a source that
 * only records the connection it was handed lets each part be driven by hand.
 */
function openRoute(
  options: { permissions?: readonly [PermissionKey, ...PermissionKey[]]; heartbeat?: 'restate' | 'empty' } = {},
): { opened: Promise<Response>; connection: () => LiveConnection<string>; teardowns: () => number } {
  let captured: LiveConnection<string> | null = null;
  let teardowns = 0;
  const route = createLiveStreamRoute<string>({
    permissions: options.permissions ?? ['audit:read'],
    heartbeat: options.heartbeat ?? 'restate',
    source: (connection) => {
      captured = connection;
      return () => {
        teardowns += 1;
      };
    },
  });

  return {
    opened: route(new Request('http://panel.local/api/audit/stream')),
    connection: () => {
      if (captured === null) throw new Error('the source was never started');
      return captured;
    },
    teardowns: () => teardowns,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.verifyApiPermission.mockReset();
  mocks.verifyApiPermission.mockResolvedValue({ authorized: true, session: { userId: '7' } });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('shared live stream route', () => {
  it('answers with the event-stream headers and the frame shape the client parses', async () => {
    const opened = openRoute();
    const response = await opened.opened;
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('X-Accel-Buffering')).toBe('no');

    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    opened.connection().emit('a frame');
    expect(await nextFrame(reader)).toBe('data: "a frame"\n\n');
    await reader.cancel();
  });

  it('restates the last frame on the heartbeat so the client watchdog stays satisfied', async () => {
    const opened = openRoute({ heartbeat: 'restate' });
    const response = await opened.opened;
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();

    opened.connection().emit('only frame');
    expect(await nextFrame(reader)).toBe('data: "only frame"\n\n');
    await vi.advanceTimersByTimeAsync(LIVE_HEARTBEAT_MS);
    expect(await nextFrame(reader)).toBe('data: "only frame"\n\n');
    await reader.cancel();
  });

  it('holds a silent stream open with an empty frame instead of restating an alert', async () => {
    const opened = openRoute({ heartbeat: 'empty' });
    const response = await opened.opened;
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();

    // A comment would never reach the client's onmessage, so the empty frame is a real one it drops.
    await vi.advanceTimersByTimeAsync(LIVE_HEARTBEAT_MS);
    expect(await nextFrame(reader)).toBe('data: {}\n\n');
    await reader.cancel();
  });

  it('refuses the connection on the first key that is not held, before the source runs', async () => {
    mocks.verifyApiPermission.mockResolvedValue({ authorized: false, response: new Response('nope', { status: 403 }) });
    let started = false;
    const route = createLiveStreamRoute<string>({
      permissions: ['audit:list', 'audit:read'],
      heartbeat: 'restate',
      source: () => {
        started = true;
        return () => undefined;
      },
    });

    const response = await route(new Request('http://panel.local/api/audit/stream'));
    expect(response.status).toBe(403);
    expect(started).toBe(false);
    expect(mocks.verifyApiPermission.mock.calls.map(([key]) => key)).toEqual(['audit:list']);
  });

  it('checks every key before handing the source its session', async () => {
    let seenSession = '';
    const route = createLiveStreamRoute<string>({
      permissions: ['audit:list', 'audit:read'],
      heartbeat: 'restate',
      source: (connection) => {
        seenSession = connection.session.userId;
        return () => undefined;
      },
    });

    const response = await route(new Request('http://panel.local/api/audit/stream'));
    expect(response.status).toBe(200);
    expect(mocks.verifyApiPermission.mock.calls.map(([key]) => key)).toEqual(['audit:list', 'audit:read']);
    expect(seenSession).toBe('7');
  });

  it('ends the stream and runs the source teardown when the client disconnects', async () => {
    const abort = new AbortController();
    let teardowns = 0;
    const route = createLiveStreamRoute<string>({
      permissions: ['audit:read'],
      heartbeat: 'restate',
      source: () => () => {
        teardowns += 1;
      },
    });

    const response = await route(new Request('http://panel.local/api/audit/stream', { signal: abort.signal }));
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    abort.abort();

    expect(await reader.read()).toEqual({ done: true, value: undefined });
    expect(teardowns).toBe(1);
    // A disconnect must also stop the heartbeat: the client is gone and nothing may keep sampling.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('runs the source teardown when the reader cancels', async () => {
    const opened = openRoute();
    const response = await opened.opened;
    await (response.body as ReadableStream<Uint8Array>).cancel();
    expect(opened.teardowns()).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ends the stream when a source cannot start, and leaves no timer behind', async () => {
    const route = createLiveStreamRoute<string>({
      permissions: ['audit:read'],
      heartbeat: 'restate',
      source: () => {
        throw new Error('probe is down');
      },
    });

    const response = await route(new Request('http://panel.local/api/audit/stream'));
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    expect(await reader.read()).toEqual({ done: true, value: undefined });
    expect(vi.getTimerCount()).toBe(0);
  });
});
