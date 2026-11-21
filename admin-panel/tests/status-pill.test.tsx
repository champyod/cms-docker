import { describe, expect, it } from 'vitest';
import { statusTone } from '@/components/core/StatusPill';

describe('statusTone', () => {
  it('maps connected states to emerald', () => {
    expect(statusTone('healthy')).toBe('emerald');
    expect(statusTone('online')).toBe('emerald');
  });
  it('maps transitional states away from red', () => {
    expect(statusTone('busy')).toBe('amber');
    expect(statusTone('starting')).toBe('blue');
  });
  it('falls back to red for stopped and unknown', () => {
    expect(statusTone('stopped')).toBe('red');
    expect(statusTone('mystery')).toBe('red');
  });
});
