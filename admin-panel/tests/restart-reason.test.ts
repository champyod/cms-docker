import { describe, expect, it } from 'vitest';
import { MAX_RESTART_REASON_CHARS, normalizeRestartReason } from '@/lib/restart-reason';

/**
 * A maintenance restart is the act the panel most needs to explain afterwards, because it is the one
 * control that can take a live contest board down. The rule being pinned here is the one the server
 * enforces: no restart runs without a stated reason, whatever path asked for it.
 */
describe('normalizeRestartReason', () => {
  it('keeps a stated reason and trims the edges', () => {
    expect(normalizeRestartReason('  applying the kernel patch  ')).toEqual({
      ok: true,
      reason: 'applying the kernel patch',
    });
  });

  it('refuses a blank reason', () => {
    expect(normalizeRestartReason('')).toEqual({ ok: false, error: expect.stringContaining('reason') });
  });

  it('refuses a reason that is only whitespace', () => {
    // Why this case exists apart from the empty one: a dialog that trims after validating would let
    // "   " through, so the spaces-only input is the one a length check alone misses.
    expect(normalizeRestartReason('   \t  ').ok).toBe(false);
  });

  it('refuses a newline-only reason', () => {
    expect(normalizeRestartReason('\n\n').ok).toBe(false);
  });

  it('caps a long reason at the limit instead of refusing it', () => {
    const long = 'x'.repeat(MAX_RESTART_REASON_CHARS + 200);
    const result = normalizeRestartReason(long);
    expect(result.ok).toBe(true);
    expect(result.ok && result.reason.length).toBe(MAX_RESTART_REASON_CHARS);
  });
});
