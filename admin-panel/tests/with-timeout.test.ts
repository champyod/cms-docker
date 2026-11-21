import { afterEach, describe, expect, it, vi } from 'vitest';

import { PANEL_READ_TIMEOUT_MS, withTimeout } from '@/lib/with-timeout';

afterEach(() => {
  vi.useRealTimers();
});

describe('withTimeout', () => {
  it('passes a read that settles in time through unchanged', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 50, 'too slow')).resolves.toBe('ok');
  });

  it('rejects a read that never settles, with the caller\'s reason', async () => {
    vi.useFakeTimers();
    const settled = expect(withTimeout(new Promise<string>(() => {}), PANEL_READ_TIMEOUT_MS, 'too slow')).rejects.toThrow('too slow');
    await vi.advanceTimersByTimeAsync(PANEL_READ_TIMEOUT_MS + 1);
    await settled;
  });

  it('keeps the read\'s own failure rather than replacing it', async () => {
    await expect(withTimeout(Promise.reject(new Error('db down')), 50, 'too slow')).rejects.toThrow('db down');
  });
});
