import { describe, expect, it } from 'vitest';
import { parseForwardedFor } from '@/lib/request-identity';

describe('parseForwardedFor', () => {
  it('returns the first hop of a forwarded chain', () => {
    expect(parseForwardedFor('203.0.113.7, 10.0.0.1, 10.0.0.2')).toBe('203.0.113.7');
  });

  it('trims the surrounding whitespace of that hop', () => {
    expect(parseForwardedFor('   203.0.113.7  , 10.0.0.1')).toBe('203.0.113.7');
  });

  it('returns the address when there is no chain', () => {
    expect(parseForwardedFor('203.0.113.7')).toBe('203.0.113.7');
  });

  it('falls back to the local sentinel when the header is absent', () => {
    expect(parseForwardedFor(null)).toBe('local');
  });
});
