import { describe, expect, it } from 'vitest';
import {
  CONSTRAINT_TO_FIELD_MAP,
  getConstraintErrorMessage,
  intervalToString,
  parseInterval,
  validateContestData,
  type ContestData,
} from '@/lib/contest-validation';

/**
 * Runtime accepts partial and null-carrying inputs (every check gates on field
 * presence) — broader than ContestData declares. Tests characterize that
 * runtime contract through this single widening point.
 */
const validateRawContest = (data: Record<string, unknown>, isUpdate = false) =>
  validateContestData(data as unknown as ContestData, isUpdate);

describe('parseInterval', () => {
  it.each([
    [undefined, 0],
    [null, 0],
    [0, 0],
    ['', 0],
    [90, 90],
    ['120', 120],
    ['01:02:03', 3723],
    ['1:2:3', 3723],
    ['not:a:time', 0],
    ['12:34', 0],
    [{ days: 1, hours: 2, minutes: 3, seconds: 4 }, 93784],
    [{ hours: 1 }, 3600],
    [{}, 0],
    [true, 0],
  ])('parses %j to %i', (input, expected) => {
    expect(parseInterval(input)).toBe(expected);
  });
});

describe('intervalToString', () => {
  it('formats seconds by default', () => {
    expect(intervalToString(45)).toBe('45 seconds');
  });

  it('formats an explicit unit', () => {
    expect(intervalToString(5, 'minutes')).toBe('5 minutes');
  });
});

describe('getConstraintErrorMessage', () => {
  it('maps known constraints', () => {
    expect(getConstraintErrorMessage('contests_check')).toBe('Start time must be before or equal to stop time');
    expect(getConstraintErrorMessage('contests_check3')).toBe('Initial tokens cannot exceed max tokens cap');
    expect(getConstraintErrorMessage('contests_token_gen_interval_check')).toBe(
      'Token generation interval must be greater than 0'
    );
  });

  it('falls back for unknown constraints', () => {
    expect(getConstraintErrorMessage('nonexistent_check')).toBe('Validation constraint failed');
  });
});

describe('CONSTRAINT_TO_FIELD_MAP', () => {
  it('maps every DB constraint to its field', () => {
    expect(CONSTRAINT_TO_FIELD_MAP['contests_check']).toBe('stop');
    expect(CONSTRAINT_TO_FIELD_MAP['contests_min_submission_interval_grace_period_check']).toBe(
      'min_submission_interval_grace_period'
    );
  });
});

describe('validateContestData', () => {
  const baseFuture = { start: '2026-01-01T00:00:00Z', stop: '2026-01-02T00:00:00Z' };

  it('accepts a fully valid contest', () => {
    const result = validateRawContest({
      ...baseFuture,
      timezone: 'UTC',
      score_precision: 2,
      token_gen_initial: 10,
      token_gen_max: 100,
      max_submission_number: 50,
      per_user_time: 60,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects start after stop', () => {
    const result = validateRawContest({ start: '2026-01-03T00:00:00Z', stop: '2026-01-02T00:00:00Z' });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      { field: 'stop', message: 'Start time must be before or equal to stop time', code: 'contests_check' },
    ]);
  });

  it('rejects stop after analysis_start', () => {
    const result = validateRawContest({
      ...baseFuture,
      analysis_start: '2026-01-01T00:00:00Z',
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe('contests_check1');
  });

  it('rejects analysis_start after analysis_stop', () => {
    const result = validateRawContest({
      ...baseFuture,
      analysis_start: '2026-01-05T00:00:00Z',
      analysis_stop: '2026-01-04T00:00:00Z',
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe('contests_check2');
  });

  it('ignores unparseable dates rather than crashing', () => {
    const result = validateRawContest({ start: 'garbage', stop: 'also-garbage' });
    expect(result.valid).toBe(true);
  });

  it('rejects negative score_precision', () => {
    const result = validateRawContest({ ...baseFuture, score_precision: -1 });
    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe('contests_score_precision_check');
  });

  it('allows null numeric fields to skip validation', () => {
    const result = validateRawContest({ ...baseFuture, score_precision: null, per_user_time: null });
    expect(result.valid).toBe(true);
  });

  it('rejects initial tokens above the generation cap', () => {
    const result = validateRawContest({ ...baseFuture, token_gen_initial: 50, token_gen_max: 10 });
    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe('contests_check3');
  });

  it('rejects non-positive token_gen_interval only in finite mode', () => {
    const finite = validateRawContest({ ...baseFuture, token_mode: 'finite', token_gen_interval: 0 });
    expect(finite.valid).toBe(false);

    const infinite = validateRawContest({ ...baseFuture, token_mode: 'infinite', token_gen_interval: 0 });
    expect(infinite.valid).toBe(true);
  });

  it('rejects non-positive token_max_number unless mode is disabled', () => {
    const enabled = validateRawContest({ ...baseFuture, token_mode: 'finite', token_max_number: 0 });
    expect(enabled.valid).toBe(false);

    const disabled = validateRawContest({ ...baseFuture, token_mode: 'disabled', token_max_number: 0 });
    expect(disabled.valid).toBe(true);
  });

  it('rejects non-positive limits when set', () => {
    const cases: Array<[Record<string, number>, string]> = [
      [{ max_submission_number: 0 }, 'contests_max_submission_number_check'],
      [{ max_user_test_number: 0 }, 'contests_max_user_test_number_check'],
      [{ min_submission_interval: 0 }, 'contests_min_submission_interval_check'],
      [{ min_user_test_interval: 0 }, 'contests_min_user_test_interval_check'],
      [{ token_gen_max: 0 }, 'contests_token_gen_max_check'],
    ];
    for (const [fields, code] of cases) {
      const result = validateRawContest({ ...baseFuture, ...fields });
      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe(code);
    }
  });

  it('rejects negative per_user_time and grace period', () => {
    const perUser = validateRawContest({ ...baseFuture, per_user_time: -5 });
    expect(perUser.errors[0].code).toBe('contests_per_user_time_check');

    const grace = validateRawContest({ ...baseFuture, min_submission_interval_grace_period: -5 });
    expect(grace.errors[0].code).toBe('contests_min_submission_interval_grace_period_check');
  });

  it('collects multiple errors at once', () => {
    const result = validateRawContest({
      start: '2026-01-03T00:00:00Z',
      stop: '2026-01-02T00:00:00Z',
      score_precision: -1,
    });
    expect(result.errors).toHaveLength(2);
  });

  it('accepts an isUpdate flag without changing validation', () => {
    const create = validateRawContest({ ...baseFuture, score_precision: -1 });
    const update = validateRawContest({ ...baseFuture, score_precision: -1 }, true);
    expect(update).toEqual(create);
  });
});
