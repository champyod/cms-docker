import { describe, expect, it } from 'vitest';

import { describeLockoutKey, isRankingLockoutKey } from '@/lib/ranking-lockouts';

const NAMESPACE = 'cms:ranking:login:';

describe('ranking lockout keys', () => {
  it('claims only the console namespace', () => {
    expect(isRankingLockoutKey(`${NAMESPACE}ada|1.2.3.4`)).toBe(true);
    expect(isRankingLockoutKey('cms:contest:login:ada|1.2.3.4')).toBe(false);
    expect(isRankingLockoutKey('other')).toBe(false);
  });

  it('describes an account and an address differently', () => {
    expect(describeLockoutKey(`${NAMESPACE}ada|1.2.3.4`)).toBe('ada from 1.2.3.4');
    expect(describeLockoutKey(`${NAMESPACE}ip#1.2.3.4`)).toBe('1.2.3.4');
  });

  it('leaves an unexpected key readable rather than throwing', () => {
    expect(describeLockoutKey(`${NAMESPACE}odd`)).toBe('odd');
  });
});

