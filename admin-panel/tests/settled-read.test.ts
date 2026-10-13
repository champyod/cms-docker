import { describe, expect, it, vi } from 'vitest';

import { readFailures, settleRead } from '@/lib/settled-read';

describe('settleRead', () => {
  it('returns the value of a read that answers', async () => {
    await expect(settleRead('part', async () => 7)).resolves.toEqual({ value: 7, failure: null });
  });

  it('names a read that rejects', async () => {
    await expect(settleRead('part', async () => {
      throw new Error('EACCES: permission denied');
    })).resolves.toEqual({ value: null, failure: { label: 'part', error: 'EACCES: permission denied' } });
  });

  it('names a read that never resolves once the bound passes', async () => {
    vi.useFakeTimers();
    const pending = settleRead('part', () => new Promise<number>(() => {}), 50);
    await vi.advanceTimersByTimeAsync(51);
    await expect(pending).resolves.toEqual({
      value: null,
      failure: { label: 'part', error: 'did not finish within 50 ms' },
    });
    vi.useRealTimers();
  });
});

describe('readFailures', () => {
  it('keeps only the failed outcomes, in order', () => {
    expect(readFailures([
      { value: 1, failure: null },
      { value: null, failure: { label: 'b', error: 'boom' } },
      { value: 2, failure: null },
    ])).toEqual([{ label: 'b', error: 'boom' }]);
  });
});
