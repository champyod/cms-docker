import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

import { LIST_CURSOR_POLL_MS, LIVE_HEARTBEAT_MS } from '@/lib/constants/live-stream';
import type { Dictionary } from '@/lib/dictionary';
import type { CursorFrame } from '@/lib/live/frames';
import { nextFrame, toFrame } from './stream-frames';

const mocks = vi.hoisted(() => ({
  verifyApiPermission: vi.fn(),
  submissionsFindFirst: vi.fn(),
  submissionsFindUnique: vi.fn(),
  evaluationsFindFirst: vi.fn(),
  resultsCount: vi.fn(),
  auditFindFirst: vi.fn(),
  requirePermission: vi.fn(),
  getSubmissions: vi.fn(),
  getSubmissionSummary: vi.fn(),
}));

vi.mock('@/lib/api-utils', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-utils')>('@/lib/api-utils');
  return { ...actual, verifyApiPermission: mocks.verifyApiPermission };
});

vi.mock('@/lib/prisma', () => ({
  prisma: {
    submissions: { findFirst: mocks.submissionsFindFirst, findUnique: mocks.submissionsFindUnique },
    evaluations: { findFirst: mocks.evaluationsFindFirst },
    submission_results: { count: mocks.resultsCount },
    audit_log: { findFirst: mocks.auditFindFirst },
  },
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }),
  redirect: vi.fn((target: string) => { throw new Error(`NEXT_REDIRECT:${target}`); }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/en/evaluation/submissions',
}));

vi.mock('@/lib/server/authorization', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/authorization')>('@/lib/server/authorization');
  return { ...actual, requirePermission: mocks.requirePermission };
});

vi.mock('@/lib/people-read-models', () => ({ getSubmissions: mocks.getSubmissions }));

vi.mock('@/lib/evaluation-read-models', () => ({ getSubmissionSummary: mocks.getSubmissionSummary }));

vi.mock('@/i18n', async () => {
  const en = await vi.importActual<{ default: Dictionary }>('@/dictionaries/en.json');
  return { getDictionary: vi.fn(async () => en.default) };
});

async function openStream(load: () => Promise<{ GET: (request: Request) => Promise<Response> }>, path: string): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const { GET } = await load();
  const response = await GET(new Request(`http://panel.local${path}`));
  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Type')).toBe('text/event-stream');
  return (response.body as ReadableStream<Uint8Array>).getReader();
}

/** The stream URL a surface hands its LiveRefresh, read from the element tree it returns. */
function liveStreamUrl(element: ReactElement): string | undefined {
  const actions = (element.props as { actions?: ReactElement<{ url?: string }> }).actions;
  return actions?.props.url;
}

const GRANTED_READERS = ['submission:list', 'submission:read'];

function grantReaders(): void {
  mocks.requirePermission.mockImplementation(async (permission: string) => {
    if (!GRANTED_READERS.includes(permission)) throw new Error(`Unexpected permission: ${permission}`);
    return new Set(GRANTED_READERS);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.verifyApiPermission.mockReset();
  mocks.verifyApiPermission.mockResolvedValue({ authorized: true, session: { userId: '1' } });
  mocks.submissionsFindFirst.mockReset();
  mocks.submissionsFindFirst.mockResolvedValue({ id: 42 });
  mocks.submissionsFindUnique.mockReset();
  mocks.submissionsFindUnique.mockResolvedValue({ comment: 'first', official: false });
  mocks.evaluationsFindFirst.mockReset();
  mocks.evaluationsFindFirst.mockResolvedValue({ id: 900 });
  mocks.resultsCount.mockReset();
  mocks.resultsCount.mockResolvedValue(2);
  mocks.auditFindFirst.mockReset();
  mocks.auditFindFirst.mockResolvedValue({ id: BigInt(11) });
  mocks.getSubmissions.mockReset();
  mocks.getSubmissions.mockResolvedValue({ submissions: [], totalPages: 1, total: 0, effectivePermissions: new Set<string>() });
  mocks.getSubmissionSummary.mockReset();
  mocks.getSubmissionSummary.mockResolvedValue({
    id: 19,
    timestamp: '2026-02-03T04:05:06.000Z',
    language: 'cpp',
    comment: '',
    official: false,
    user: null,
    contest: null,
    task: null,
    capabilities: { canUpdate: false, canRecompute: false, canDownload: false, canMoveLane: false },
  });
  grantReaders();
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * The submissions surfaces' live layer: the list and the record each publish the cursor their own
 * reader acts on, and each surface opens exactly one connection to it.
 */
describe('submissions list stream', () => {
  it('opens with the newest submission, grading row and write, and stays quiet while they stand', async () => {
    const reader = await openStream(() => import('@/app/api/submissions/stream/route'), '/api/submissions/stream');

    expect(toFrame<CursorFrame>((await nextFrame(reader)) as string)).toEqual({ cursor: '42:900:11' });
    expect(mocks.auditFindFirst.mock.calls[0][0].where).toEqual({ entity: 'submission' });

    await vi.advanceTimersByTimeAsync(LIST_CURSOR_POLL_MS);
    expect(mocks.submissionsFindFirst.mock.calls.length).toBeGreaterThan(1);
    expect(await nextFrame(reader)).toBeNull();

    await reader.cancel();
  });

  it('moves the cursor when a submission arrives', async () => {
    const reader = await openStream(() => import('@/app/api/submissions/stream/route'), '/api/submissions/stream');
    await nextFrame(reader);

    mocks.submissionsFindFirst.mockResolvedValue({ id: 43 });
    await vi.advanceTimersByTimeAsync(LIST_CURSOR_POLL_MS);
    expect(toFrame<CursorFrame>((await nextFrame(reader)) as string)).toEqual({ cursor: '43:900:11' });

    await reader.cancel();
  });

  it('moves the cursor when a grading run commits a testcase', async () => {
    const reader = await openStream(() => import('@/app/api/submissions/stream/route'), '/api/submissions/stream');
    await nextFrame(reader);

    mocks.evaluationsFindFirst.mockResolvedValue({ id: 901 });
    await vi.advanceTimersByTimeAsync(LIST_CURSOR_POLL_MS);
    expect(toFrame<CursorFrame>((await nextFrame(reader)) as string)).toEqual({ cursor: '42:901:11' });

    await reader.cancel();
  });

  it('moves the cursor when a submission write is recorded', async () => {
    const reader = await openStream(() => import('@/app/api/submissions/stream/route'), '/api/submissions/stream');
    await nextFrame(reader);

    mocks.auditFindFirst.mockResolvedValue({ id: BigInt(12) });
    await vi.advanceTimersByTimeAsync(LIST_CURSOR_POLL_MS);
    expect(toFrame<CursorFrame>((await nextFrame(reader)) as string)).toEqual({ cursor: '42:900:12' });

    await reader.cancel();
  });

  it('reports an empty table as a null cursor rather than as a read', async () => {
    mocks.submissionsFindFirst.mockResolvedValue(null);
    mocks.evaluationsFindFirst.mockResolvedValue(null);
    mocks.auditFindFirst.mockResolvedValue(null);

    const reader = await openStream(() => import('@/app/api/submissions/stream/route'), '/api/submissions/stream');
    expect(toFrame<CursorFrame>((await nextFrame(reader)) as string)).toEqual({ cursor: '::' });

    await reader.cancel();
  });

  it('restates the cursor on the heartbeat so a quiet list is told apart from a dead stream', async () => {
    const reader = await openStream(() => import('@/app/api/submissions/stream/route'), '/api/submissions/stream');
    await nextFrame(reader);

    await vi.advanceTimersByTimeAsync(LIVE_HEARTBEAT_MS);
    expect(toFrame<CursorFrame>((await nextFrame(reader)) as string)).toEqual({ cursor: '42:900:11' });

    await reader.cancel();
  });

  it('refuses a viewer without submission:list, and never reads a submission for them', async () => {
    mocks.verifyApiPermission.mockResolvedValue({ authorized: false, response: new Response('nope', { status: 403 }) });
    const { GET } = await import('@/app/api/submissions/stream/route');

    const response = await GET(new Request('http://panel.local/api/submissions/stream'));
    expect(response.status).toBe(403);
    expect(mocks.verifyApiPermission.mock.calls.map(([key]) => key)).toEqual(['submission:list']);
    expect(mocks.submissionsFindFirst).not.toHaveBeenCalled();
    expect(mocks.evaluationsFindFirst).not.toHaveBeenCalled();
  });

  it('closes the connection on abort, taking its polling with it', async () => {
    const abort = new AbortController();
    const { GET } = await import('@/app/api/submissions/stream/route');
    const response = await GET(
      new Request('http://panel.local/api/submissions/stream', { signal: abort.signal }),
    );
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();

    const opening = await reader.read();
    expect(new TextDecoder().decode(opening.value)).toBe('data: {"cursor":"42:900:11"}\n\n');

    abort.abort();
    expect(await reader.read()).toEqual({ done: true, value: undefined });
    // Why the flush: the source's teardown is handed back one microtask after its first frame, and a
    // disconnect can land in between.
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('submission record stream', () => {
  it('cursors one record on its own row, its own grading rows and its own results', async () => {
    const reader = await openStream(() => import('@/app/api/submissions/[id]/stream/route'), '/api/submissions/19/stream');

    expect(toFrame<CursorFrame>((await nextFrame(reader)) as string)).toEqual({ cursor: 'first:false:900:2' });
    expect(mocks.submissionsFindUnique.mock.calls[0][0].where).toEqual({ id: 19 });
    expect(mocks.evaluationsFindFirst.mock.calls[0][0].where).toEqual({ submission_id: 19 });
    expect(mocks.resultsCount.mock.calls[0][0].where).toEqual({ submission_id: 19 });

    await reader.cancel();
  });

  it('moves the cursor when the record is edited', async () => {
    const reader = await openStream(() => import('@/app/api/submissions/[id]/stream/route'), '/api/submissions/19/stream');
    await nextFrame(reader);

    mocks.submissionsFindUnique.mockResolvedValue({ comment: 'second', official: true });
    await vi.advanceTimersByTimeAsync(LIST_CURSOR_POLL_MS);
    expect(toFrame<CursorFrame>((await nextFrame(reader)) as string)).toEqual({ cursor: 'second:true:900:2' });

    await reader.cancel();
  });

  it('moves the cursor when the record is regraded', async () => {
    const reader = await openStream(() => import('@/app/api/submissions/[id]/stream/route'), '/api/submissions/19/stream');
    await nextFrame(reader);

    mocks.evaluationsFindFirst.mockResolvedValue({ id: 902 });
    mocks.resultsCount.mockResolvedValue(3);
    await vi.advanceTimersByTimeAsync(LIST_CURSOR_POLL_MS);
    expect(toFrame<CursorFrame>((await nextFrame(reader)) as string)).toEqual({ cursor: 'first:false:902:3' });

    await reader.cancel();
  });

  it('restates the record cursor on the heartbeat', async () => {
    const reader = await openStream(() => import('@/app/api/submissions/[id]/stream/route'), '/api/submissions/19/stream');
    await nextFrame(reader);

    await vi.advanceTimersByTimeAsync(LIVE_HEARTBEAT_MS);
    expect(toFrame<CursorFrame>((await nextFrame(reader)) as string)).toEqual({ cursor: 'first:false:900:2' });

    await reader.cancel();
  });

  it('refuses a viewer without submission:read, and never reads the record for them', async () => {
    mocks.verifyApiPermission.mockResolvedValue({ authorized: false, response: new Response('nope', { status: 403 }) });
    const { GET } = await import('@/app/api/submissions/[id]/stream/route');

    const response = await GET(new Request('http://panel.local/api/submissions/19/stream'));
    expect(response.status).toBe(403);
    expect(mocks.verifyApiPermission.mock.calls.map(([key]) => key)).toEqual(['submission:read']);
    expect(mocks.submissionsFindUnique).not.toHaveBeenCalled();
  });

  it('sits still on a path that names no record, rather than reading one', async () => {
    const reader = await openStream(
      () => import('@/app/api/submissions/[id]/stream/route'),
      '/api/submissions/19abc/stream',
    );

    expect(toFrame<CursorFrame>((await nextFrame(reader)) as string)).toEqual({ cursor: '' });
    expect(mocks.submissionsFindUnique).not.toHaveBeenCalled();
    expect(mocks.evaluationsFindFirst).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(LIST_CURSOR_POLL_MS);
    expect(await nextFrame(reader)).toBeNull();

    await reader.cancel();
  });
});

describe('submissions live wiring', () => {
  it('refreshes the list through its own stream', async () => {
    const { default: EvaluationSubmissionsPage } = await import('@/app/[locale]/(authenticated)/evaluation/submissions/page');

    const element = await EvaluationSubmissionsPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    expect(liveStreamUrl(element)).toBe('/api/submissions/stream');
  });

  it("refreshes the record through the record's own stream, not the list's", async () => {
    const { default: SubmissionRecordLayout } = await import('@/app/[locale]/(authenticated)/evaluation/submissions/[id]/layout');

    const element = await SubmissionRecordLayout({
      children: null,
      params: Promise.resolve({ locale: 'en', id: '19' }),
    });

    expect(liveStreamUrl(element)).toBe('/api/submissions/19/stream');
  });
});
