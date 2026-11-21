import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { nextFrame, toFrame } from './stream-frames';
import type { QuestionsFrame } from '@/lib/live/frames';

const mocks = vi.hoisted(() => ({
  verifyApiPermission: vi.fn(),
  readUnansweredQuestions: vi.fn(),
}));

vi.mock('@/lib/api-utils', () => ({ verifyApiPermission: mocks.verifyApiPermission }));
vi.mock('@/lib/questions-reader', () => ({ readUnansweredQuestions: mocks.readUnansweredQuestions }));

const WAITING: QuestionsFrame = {
  unansweredCount: 1,
  latest: { id: 4, subject: 'How do I rejudge?', username: 'ada', askedAt: '2026-10-13T09:00:00.000Z' },
};

async function openStream(signal?: AbortSignal): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const { GET } = await import('@/app/api/questions/stream/route');
  const request = signal === undefined
    ? new Request('http://panel.local/api/questions/stream')
    : new Request('http://panel.local/api/questions/stream', { signal });
  const response = await GET(request);
  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Type')).toBe('text/event-stream');
  return (response.body as ReadableStream<Uint8Array>).getReader();
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.verifyApiPermission.mockReset();
  mocks.verifyApiPermission.mockResolvedValue({ authorized: true, session: { userId: '1' } });
  mocks.readUnansweredQuestions.mockReset();
  mocks.readUnansweredQuestions.mockResolvedValue(WAITING);
});

afterEach(() => {
  vi.useRealTimers();
});

/** The header's question signal: the count behind its dot and the newest row behind its alert. */
describe('questions stream', () => {
  it('opens with the unanswered count and the newest question', async () => {
    const reader = await openStream();
    expect(toFrame<QuestionsFrame>((await nextFrame(reader)) as string)).toEqual(WAITING);
    await reader.cancel();
  });

  it('closes the connection on abort', async () => {
    const abort = new AbortController();
    const reader = await openStream(abort.signal);
    await reader.read();

    abort.abort();
    expect(await reader.read()).toEqual({ done: true, value: undefined });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('refuses a viewer who may not list questions, and never reads them', async () => {
    mocks.verifyApiPermission.mockResolvedValue({ authorized: false, response: new Response('nope', { status: 403 }) });
    const { GET } = await import('@/app/api/questions/stream/route');

    const response = await GET(new Request('http://panel.local/api/questions/stream'));
    expect(response.status).toBe(403);
    expect(mocks.verifyApiPermission).toHaveBeenCalledWith('question:list');
    expect(mocks.readUnansweredQuestions).not.toHaveBeenCalled();
  });
});
