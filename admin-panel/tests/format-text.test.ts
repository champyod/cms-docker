import { describe, expect, it } from 'vitest';
import { humanizeEnum } from '@/lib/format-text';

describe('humanizeEnum', () => {
  it('turns the underscore separators into spaces', () => {
    expect(humanizeEnum('partial_credit')).toBe('partial credit');
  });

  it('leaves a value with no separator exactly as stored', () => {
    expect(humanizeEnum('sum')).toBe('sum');
  });

  it('replaces every separator, not only the first', () => {
    expect(humanizeEnum('every_submission_counts_once')).toBe('every submission counts once');
  });

  // A separator at the edge is what a trailing-underscore column produces.
  it('does not trim a separator at the edge', () => {
    expect(humanizeEnum('_sum_')).toBe(' sum ');
  });
});
