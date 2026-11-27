import { describe, expect, it } from 'vitest';
import {
  FORWARDED_TRUST_HEADER,
  parseForwardedFor,
  resolveForwardedAddress,
} from '@/lib/request-identity';

/**
 * Which forwarded address the panel may believe.
 *
 * Why a marker and not a peer allowlist: a Next server action reaches the handler with the
 * proxy's headers and nothing else — the app router exposes no socket peer, so the panel
 * cannot tell a proxy apart from a direct caller by address. The stack's answer is a header
 * the proxy writes and a caller cannot forge, and its absence has to fail closed: believing
 * an unmarked chain would let any caller pick the login bucket it is counted in and the
 * address an audit row records.
 */
describe('forwarded address trust', () => {
  const MARKER = 'proxy-marker-value';

  it('believes the chain when the proxy marked the request', () => {
    const headers = new Headers({
      'x-forwarded-for': '203.0.113.7, 10.0.0.1',
      'x-real-ip': '10.0.0.1',
      [FORWARDED_TRUST_HEADER]: MARKER,
    });

    expect(resolveForwardedAddress(headers, MARKER)).toBe('10.0.0.1');
  });

  it('refuses a chain that arrives without the marker', () => {
    const headers = new Headers({
      'x-forwarded-for': '1.2.3.4',
      [FORWARDED_TRUST_HEADER]: MARKER,
    });
    const unmarked = new Headers({ 'x-forwarded-for': '1.2.3.4' });

    expect(resolveForwardedAddress(unmarked, MARKER)).toBe('local');
    expect(resolveForwardedAddress(headers, MARKER)).toBe('1.2.3.4');
  });

  it('refuses a wrong marker, so a caller cannot invent one', () => {
    const headers = new Headers({
      'x-forwarded-for': '1.2.3.4',
      [FORWARDED_TRUST_HEADER]: 'not-the-marker',
    });

    expect(resolveForwardedAddress(headers, MARKER)).toBe('local');
  });

  it('refuses every chain when no marker is configured', () => {
    const headers = new Headers({
      'x-forwarded-for': '1.2.3.4',
      [FORWARDED_TRUST_HEADER]: '',
    });

    expect(resolveForwardedAddress(headers, '')).toBe('local');
    expect(resolveForwardedAddress(headers, undefined)).toBe('local');
  });

  it('still names the nearest proxy hop once the trust is settled', () => {
    expect(parseForwardedFor('1.2.3.4, 198.51.100.9')).toBe('198.51.100.9');
  });
});
