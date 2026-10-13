import { describe, expect, it } from 'vitest';

import { describeLoginLockoutKey, isLoginLockoutKey } from '@/lib/login-lockouts';

const NAMESPACE = 'cms:login:';

describe('server login lockout keys', () => {
  it('claims only the Python counter namespace', () => {
    expect(isLoginLockoutKey(`${NAMESPACE}ada|1.2.3.4`)).toBe(true);
    expect(isLoginLockoutKey('cms:ranking:login:ada|1.2.3.4')).toBe(false);
    expect(isLoginLockoutKey('other')).toBe(false);
  });

  it('describes an account and an address differently', () => {
    expect(describeLoginLockoutKey(`${NAMESPACE}ada|1.2.3.4`)).toBe('ada from 1.2.3.4');
    expect(describeLoginLockoutKey(`${NAMESPACE}ip#1.2.3.4`)).toBe('1.2.3.4');
  });

  it('leaves an unexpected key readable rather than throwing', () => {
    expect(describeLoginLockoutKey(`${NAMESPACE}odd`)).toBe('odd');
  });
});
