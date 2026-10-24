import { afterEach, describe, expect, it, vi } from 'vitest';

import { getRankingDiagnostics } from '@/lib/ranking-diagnostics';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function respond(body: unknown, init: { status?: number } = {}): void {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { 'content-type': 'application/json' },
    }),
  ) as unknown as typeof fetch;
}

/** A body carrying every counter the current service reports. */
function fullBody(overrides: Record<string, number> = {}): Record<string, number> {
  return {
    skipped_overrides: 1,
    skipped_subchanges: 9,
    hidden_task_subchanges: 4,
    unknown_task_subchanges: 3,
    orphan_subchanges: 2,
    unknown_task_hides: 3,
    withheld_task_hides: 1,
    renamed_task_hides: 1,
    unmatched_task_hides: 1,
    ...overrides,
  };
}

describe('getRankingDiagnostics', () => {
  it('reads the summary counters and both breakdowns', async () => {
    respond(fullBody());

    expect(await getRankingDiagnostics()).toEqual({
      reachable: true,
      skippedOverrides: 1,
      skippedSubchanges: 9,
      subchangeCauses: {
        hiddenTaskSubchanges: 4,
        unknownTaskSubchanges: 3,
        orphanSubchanges: 2,
      },
      hideCauses: {
        unknownTaskHides: 3,
        withheldTaskHides: 1,
        renamedTaskHides: 1,
        unmatchedTaskHides: 1,
      },
    });
  });

  it('reports a clean board as reachable with zero counts', async () => {
    respond({
      ...fullBody(),
      skipped_overrides: 0,
      skipped_subchanges: 0,
      hidden_task_subchanges: 0,
      unknown_task_subchanges: 0,
      orphan_subchanges: 0,
      unknown_task_hides: 0,
      withheld_task_hides: 0,
      renamed_task_hides: 0,
      unmatched_task_hides: 0,
    });

    const result = await getRankingDiagnostics();
    expect(result).toMatchObject({ reachable: true, skippedOverrides: 0, skippedSubchanges: 0 });
    if (!result.reachable) throw new Error('unreachable');
    expect(result.subchangeCauses).toEqual({
      hiddenTaskSubchanges: 0,
      unknownTaskSubchanges: 0,
      orphanSubchanges: 0,
    });
    expect(result.hideCauses).toEqual({
      unknownTaskHides: 0,
      withheldTaskHides: 0,
      renamedTaskHides: 0,
      unmatchedTaskHides: 0,
    });
  });

  // The breakdown arrived after the two summary counters, so a service that predates it must keep
  // reading as reachable — with a null breakdown, never with zeros. A zero would claim the
  // service measured the causes and found none, which it never said.
  it('reports a breakdown the service omits as not reported rather than as zeros', async () => {
    respond({ ready: true, skipped_overrides: 3, skipped_subchanges: 1 });

    expect(await getRankingDiagnostics()).toEqual({
      reachable: true,
      skippedOverrides: 3,
      skippedSubchanges: 1,
      subchangeCauses: null,
      hideCauses: null,
    });
  });

  // Half a partition is not a partition: filling the missing members with zeros would report
  // numbers the service never sent, so the whole group reads as not reported.
  it('treats a half-reported group as not reported', async () => {
    const body = fullBody();
    delete (body as Record<string, number | undefined>).orphan_subchanges;
    respond(body);

    const result = await getRankingDiagnostics();
    if (!result.reachable) throw new Error('unreachable');
    expect(result.subchangeCauses).toBeNull();
    expect(result.hideCauses).not.toBeNull();
  });

  it('treats an impossible count in one group as that group being unreported', async () => {
    respond(fullBody({ renamed_task_hides: -2 }));

    const result = await getRankingDiagnostics();
    if (!result.reachable) throw new Error('unreachable');
    expect(result.hideCauses).toBeNull();
    expect(result.subchangeCauses).not.toBeNull();
  });

  // Why this is the load-bearing case: the route refuses rather than reporting zeros
  // "so an empty board and an unreadable store do not look alike". Turning its 503 back
  // into zero counts here would undo exactly that, and the card would go quiet on the
  // one occasion it matters.
  it('reports the service refusal as unreachable, never as zero', async () => {
    respond({ status: 'unavailable' }, { status: 503 });
    const result = await getRankingDiagnostics();
    expect(result.reachable).toBe(false);
    expect(result).not.toHaveProperty('skippedOverrides');
  });

  it('reports a transport failure as unreachable rather than throwing', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    }) as unknown as typeof fetch;
    const result = await getRankingDiagnostics();
    expect(result.reachable).toBe(false);
    if (result.reachable) throw new Error('unreachable');
    expect(result.reason).toContain('ECONNREFUSED');
  });

  it('reports a non-JSON body as unreachable', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('<html>login</html>', { status: 200 }),
    ) as unknown as typeof fetch;
    const result = await getRankingDiagnostics();
    expect(result.reachable).toBe(false);
    if (result.reachable) throw new Error('unreachable');
    expect(result.reason).toContain('not JSON');
  });

  // The summary counters are still required: they are what the panel has always read, so a body
  // without them is not a diagnostics response at all.
  it('rejects a negative or non-integer count as a malformed response', async () => {
    respond({ ready: true, skipped_overrides: -1, skipped_subchanges: 0 });
    const result = await getRankingDiagnostics();
    expect(result.reachable).toBe(false);
  });

  it('rejects a body missing the counters entirely', async () => {
    respond({ ready: true });
    const result = await getRankingDiagnostics();
    expect(result.reachable).toBe(false);
  });

  it('addresses the ranking service by its compose container name', async () => {
    const spy = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));
    globalThis.fetch = spy;
    await getRankingDiagnostics();
    expect(String(spy.mock.calls[0]?.[0])).toBe(
      'http://cms-ranking-web-server:8890/diagnostics',
    );
  });

  // The read decorates a page that must still render, so a hanging service cannot be
  // allowed to hold the request open.
  it('bounds the read with a timeout signal', async () => {
    const spy = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));
    globalThis.fetch = spy;
    await getRankingDiagnostics();
    const init = spy.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});
