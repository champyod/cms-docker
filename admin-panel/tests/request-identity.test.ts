import { describe, expect, it } from 'vitest';
import { parseForwardedFor } from '@/lib/request-identity';

describe('parseForwardedFor', () => {
  it('reads the hop the nearest proxy appended, not the one the caller sent', () => {
    expect(parseForwardedFor('203.0.113.7, 10.0.0.1, 10.0.0.2')).toBe('10.0.0.2');
  });

  it('cannot be steered by a caller-supplied first entry', () => {
    expect(parseForwardedFor('1.2.3.4, 198.51.100.9')).toBe('198.51.100.9');
  });

  it('trims the surrounding whitespace of that hop', () => {
    expect(parseForwardedFor('203.0.113.7,   10.0.0.1  ')).toBe('10.0.0.1');
  });

  it('skips empty trailing entries to reach the asserted hop', () => {
    expect(parseForwardedFor('203.0.113.7, ')).toBe('203.0.113.7');
  });

  it('returns the address when there is no chain', () => {
    expect(parseForwardedFor('203.0.113.7')).toBe('203.0.113.7');
  });

  it('falls back to the asserted real address when no chain arrives', () => {
    expect(parseForwardedFor(null, '203.0.113.7')).toBe('203.0.113.7');
    expect(parseForwardedFor('', '203.0.113.7')).toBe('203.0.113.7');
  });

  it('prefers the forwarded chain over the real address of the same request', () => {
    expect(parseForwardedFor('203.0.113.7, 198.51.100.9', '10.0.0.1')).toBe('198.51.100.9');
  });

  it('falls back to the local sentinel only when no proxy asserted anything', () => {
    expect(parseForwardedFor(null)).toBe('local');
    expect(parseForwardedFor(null, null)).toBe('local');
    expect(parseForwardedFor('', '   ')).toBe('local');
  });
});
