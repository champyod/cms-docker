import { describe, expect, it } from 'vitest';
import { parseClientAddress, parseForwardedFor } from '@/lib/request-identity';

describe('parseForwardedFor', () => {
  it('returns the last hop of a forwarded chain, the one the edge appended', () => {
    expect(parseForwardedFor('203.0.113.7, 10.0.0.1, 10.0.0.2')).toBe('10.0.0.2');
  });

  it('trims the surrounding whitespace of that hop', () => {
    expect(parseForwardedFor('203.0.113.7,    10.0.0.1  ')).toBe('10.0.0.1');
  });

  it('returns the address when there is no chain', () => {
    expect(parseForwardedFor('203.0.113.7')).toBe('203.0.113.7');
  });

  it('falls back to the local sentinel when the header is absent', () => {
    expect(parseForwardedFor(null)).toBe('local');
  });

  it('skips empty and whitespace-only hops when picking the last one', () => {
    expect(parseForwardedFor('203.0.113.7, 10.0.0.1, ,   ')).toBe('10.0.0.1');
  });

  it('falls back to the local sentinel when every hop is blank', () => {
    expect(parseForwardedFor('   ,  ,')).toBe('local');
    expect(parseForwardedFor('')).toBe('local');
  });

  it('ignores a caller-supplied first hop, which would otherwise pick its own bucket', () => {
    expect(parseForwardedFor('9.9.9.9, 203.0.113.7')).toBe('203.0.113.7');
  });
});

describe('parseClientAddress', () => {
  it('prefers X-Real-IP over the forwarded chain', () => {
    expect(parseClientAddress('203.0.113.7', '9.9.9.9, 198.51.100.4')).toBe('203.0.113.7');
  });

  it('trims X-Real-IP', () => {
    expect(parseClientAddress('  203.0.113.7  ', null)).toBe('203.0.113.7');
  });

  it('falls back to the last forwarded hop when X-Real-IP is absent', () => {
    expect(parseClientAddress(null, '9.9.9.9, 203.0.113.7')).toBe('203.0.113.7');
  });

  it('falls back to the forwarded chain when X-Real-IP is blank', () => {
    expect(parseClientAddress('   ', '9.9.9.9, 203.0.113.7')).toBe('203.0.113.7');
    expect(parseClientAddress('', '9.9.9.9, 203.0.113.7')).toBe('203.0.113.7');
  });

  it('falls back to the local sentinel when neither header is usable', () => {
    expect(parseClientAddress(null, null)).toBe('local');
    expect(parseClientAddress('   ', '')).toBe('local');
  });

  it('lets a caller-supplied first hop change nothing when X-Real-IP is present', () => {
    expect(parseClientAddress('203.0.113.7', '9.9.9.9, 10.0.0.1, 203.0.113.7')).toBe('203.0.113.7');
  });
});
