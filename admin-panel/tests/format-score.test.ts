import { describe, expect, it } from 'vitest';
import { formatScore } from '@/lib/format-number';

describe('formatScore', () => {
  it('prints exactly the precision the task declares', () => {
    expect(formatScore(100, 0)).toBe('100');
    expect(formatScore(87.5, 1)).toBe('87.5');
    expect(formatScore(12.345, 3)).toBe('12.345');
  });

  it('groups a large total in the reader locale', () => {
    expect(formatScore(12345.5, 1)).toBe('12,345.5');
  });

  // Why: a score that is not a finite number is not a score, and must not print as "NaN".
  it('prints a non-finite value as given rather than as a formatted number', () => {
    expect(formatScore(Number.NaN, 2)).toBe('NaN');
  });
});
