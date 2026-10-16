import { describe, expect, it } from 'vitest';

import { pickLimitPatch, unsetLimitPatch } from '@/lib/limit-patch';
import { LIMIT_FIELDS } from '@/lib/limits';

describe('pickLimitPatch', () => {
  it('keeps an explicit null, because a clear is a real write', () => {
    expect(pickLimitPatch({ max_submission_number: null })).toEqual({ max_submission_number: null });
  });

  it('drops an undefined value, because an unset field means leave the target alone', () => {
    expect(pickLimitPatch({ max_submission_number: undefined })).toBeNull();
    expect(pickLimitPatch({ max_submission_number: undefined, token_gen_max: 4 })).toEqual({ token_gen_max: 4 });
  });

  it('keeps an unknown key out while the named limit still goes through', () => {
    expect(pickLimitPatch({ name: 'smuggled', min_submission_interval: 90 })).toEqual({ min_submission_interval: 90 });
  });

  it('reads a 0, a blank and a negative as a clear, never as a value the CHECK refuses', () => {
    expect(pickLimitPatch({ max_submission_number: 0, max_user_test_number: '', token_gen_max: -3 })).toEqual({
      max_submission_number: null,
      max_user_test_number: null,
      token_gen_max: null,
    });
    expect(pickLimitPatch({ min_submission_interval: 0 })).toEqual({ min_submission_interval: null });
  });

  it('refuses a patch that names no limit field at all', () => {
    expect(pickLimitPatch({})).toBeNull();
    expect(pickLimitPatch({ name: 'Autumn', start: '2026-01-01' })).toBeNull();
    expect(pickLimitPatch(undefined)).toBeNull();
    expect(pickLimitPatch(null)).toBeNull();
    expect(pickLimitPatch('max_submission_number')).toBeNull();
    expect(pickLimitPatch(5)).toBeNull();
  });

  it('names every limit field as a clear for an editor that must show them all', () => {
    const patch = unsetLimitPatch();
    expect(Object.keys(patch).sort()).toEqual([...LIMIT_FIELDS].sort());
    expect(Object.values(patch)).toEqual(LIMIT_FIELDS.map(() => null));
  });
});
