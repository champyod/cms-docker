import { describe, expect, it } from 'vitest';

import { alertDetail, isLockout, LOCKOUT_THRESHOLD } from '@/scheduler/lockout-alerts';

describe('lockout alert selection', () => {
  it('alerts only once a counter reaches the refusal threshold', () => {
    expect(isLockout(LOCKOUT_THRESHOLD - 1)).toBe(false);
    expect(isLockout(LOCKOUT_THRESHOLD)).toBe(true);
    expect(isLockout(LOCKOUT_THRESHOLD + 3)).toBe(true);
  });

  it('names the subject and the failures so the page is actionable', () => {
    const detail = alertDetail({
      key: 'cms:login:ada|1.2.3.4',
      subject: 'ada from 1.2.3.4',
      count: LOCKOUT_THRESHOLD,
      retryAfterSeconds: 60,
    });

    expect(detail).toContain('ada from 1.2.3.4');
    expect(detail).toContain('5');
    expect(detail).toContain('60s');
  });
});
