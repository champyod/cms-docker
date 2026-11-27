import { describe, expect, it } from 'vitest';
import { isSecureCookie } from '@/lib/cookie-security';

describe('session cookie secure setting', () => {
  it.each([undefined, '', 'true', '1', 'yes', 'on', 'unexpected'])(
    'keeps Secure for %s',
    (value) => {
      expect(isSecureCookie(value)).toBe(true);
    },
  );

  it.each(['false', '0', 'no', 'off', ' FALSE '])(
    'allows an explicit local HTTP override for %s',
    (value) => {
      expect(isSecureCookie(value)).toBe(false);
    },
  );
});
