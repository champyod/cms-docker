import { afterEach, describe, expect, it, vi } from 'vitest';
import { EVALUATION_RPC_TIMEOUT_MS, invalidateViaRpc } from '@/lib/evaluation-rpc';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('invalidateViaRpc', () => {
  it('reports accepted when the service responds ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })));
    await expect(invalidateViaRpc(7, 3, 'score')).resolves.toEqual({ accepted: true, timedOut: false });
  });

  it('reports not accepted when the service responds with an error status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })));
    await expect(invalidateViaRpc(7, 3, 'score')).resolves.toEqual({ accepted: false, timedOut: false });
  });

  it('reports neither accepted nor timed out on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))));
    await expect(invalidateViaRpc(7, 3, 'score')).resolves.toEqual({ accepted: false, timedOut: false });
  });

  it('aborts a hanging service and reports a timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        })
      )
    );

    const pending = invalidateViaRpc(7, 3, 'score');
    await vi.advanceTimersByTimeAsync(EVALUATION_RPC_TIMEOUT_MS);
    await expect(pending).resolves.toEqual({ accepted: false, timedOut: true });
  });
});
