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

describe('getRankingDiagnostics', () => {
  it('reads the two counters the service reports', async () => {
    respond({ ready: true, skipped_overrides: 3, skipped_subchanges: 1 });
    expect(await getRankingDiagnostics()).toEqual({
      reachable: true,
      skippedOverrides: 3,
      skippedSubchanges: 1,
    });
  });

  it('reports a clean board as reachable with zero counts', async () => {
    respond({ ready: true, skipped_overrides: 0, skipped_subchanges: 0 });
    expect(await getRankingDiagnostics()).toEqual({
      reachable: true,
      skippedOverrides: 0,
      skippedSubchanges: 0,
    });
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
    const spy = vi.fn(async () => new Response('{}', { status: 200 }));
    globalThis.fetch = spy as unknown as typeof fetch;
    await getRankingDiagnostics();
    expect(String(spy.mock.calls[0][0])).toBe(
      'http://cms-ranking-web-server:8890/diagnostics',
    );
  });

  // The read decorates a page that must still render, so a hanging service cannot be
  // allowed to hold the request open.
  it('bounds the read with a timeout signal', async () => {
    const spy = vi.fn(async () => new Response('{}', { status: 200 }));
    globalThis.fetch = spy as unknown as typeof fetch;
    await getRankingDiagnostics();
    const init = spy.mock.calls[0][1] as RequestInit | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});
