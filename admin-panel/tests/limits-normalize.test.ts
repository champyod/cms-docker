import { describe, expect, it } from 'vitest';

import en from '@/dictionaries/en.json';
import th from '@/dictionaries/th.json';
import { LIMIT_FIELDS, normalizeLimitValue } from '@/lib/limits';

describe('the nullable limit rule', () => {
  it('names the six columns both kinds write', () => {
    expect([...LIMIT_FIELDS]).toEqual([
      'max_submission_number',
      'max_user_test_number',
      'token_max_number',
      'token_gen_max',
      'min_submission_interval',
      'min_user_test_interval',
    ]);
  });

  it('reads a blank box, a 0, and a missing value as no limit', () => {
    // Why 0 belongs in this list: the operator's decision is that an empty box and a 0 say the
    // same thing, and the only value the columns can hold for "no limit" is NULL.
    for (const blank of [undefined, null, '', 0, '0', NaN, 'nonsense']) {
      expect(normalizeLimitValue(blank), String(blank)).toBeNull();
    }
  });

  it('passes a positive whole number through', () => {
    expect(normalizeLimitValue(5)).toBe(5);
    expect(normalizeLimitValue('90')).toBe(90);
    expect(normalizeLimitValue(1)).toBe(1);
  });

  it('refuses a negative or fractional entry rather than storing a value nothing can use', () => {
    for (const unusable of [-1, '-5', 2.5, '2.5', Infinity, -Infinity]) {
      expect(normalizeLimitValue(unusable), String(unusable)).toBeNull();
    }
  });

  it('carries a label and an explanation for every name in the family, in both locales', () => {
    for (const name of LIMIT_FIELDS) {
      expect(en.limits.fields[name].trim(), `en ${name}`).not.toBe('');
      expect(th.limits.fields[name].trim(), `th ${name}`).not.toBe('');
      expect(en.limits.hints[name].trim(), `en hint ${name}`).not.toBe('');
      expect(th.limits.hints[name].trim(), `th hint ${name}`).not.toBe('');
    }
    expect(en.limits.unlimited.trim()).not.toBe('');
    expect(th.limits.unlimited.trim()).not.toBe('');
  });

  it('carries a label and an explanation for the dataset pair in both locales', () => {
    // Why here: the dataset time and memory limits render through the same shared field, so their
    // copy has to survive the same Thai-may-not-lag-behind guard as the family above.
    for (const name of ['time_limit', 'memory_limit'] as const) {
      expect(en.limits.fields[name].trim(), `en ${name}`).not.toBe('');
      expect(th.limits.fields[name].trim(), `th ${name}`).not.toBe('');
      expect(en.limits.hints[name].trim(), `en hint ${name}`).not.toBe('');
      expect(th.limits.hints[name].trim(), `th hint ${name}`).not.toBe('');
    }
  });
});
