import { describe, expect, it } from 'vitest';
import { parseFilename } from '@/utils/filenameParser';

describe('parseFilename', () => {
  it('extracts a single-star id', () => {
    expect(parseFilename('task.1.in', 'task.*.in')).toBe('1');
    expect(parseFilename('task.12345.in', 'task.*.in')).toBe('12345');
  });

  it('extracts a double-star two-digit id', () => {
    expect(parseFilename('prob_01.out', 'prob_**.out')).toBe('01');
  });

  it('requires exactly two digits for **', () => {
    expect(parseFilename('prob_1.out', 'prob_**.out')).toBeNull();
    expect(parseFilename('prob_123.out', 'prob_**.out')).toBeNull();
  });

  it('returns null when the filename does not match', () => {
    expect(parseFilename('other.1.in', 'task.*.in')).toBeNull();
    expect(parseFilename('task.1.out', 'task.*.in')).toBeNull();
  });

  it('escapes regex metacharacters in the pattern', () => {
    expect(parseFilename('a.b2', 'a.b*')).toBe('2');
    expect(parseFilename('axb2', 'a.b*')).toBeNull();
  });

  it('returns null when the pattern has no wildcard capture', () => {
    expect(parseFilename('fixed.txt', 'fixed.txt')).toBeNull();
  });

  it('anchors the match to the whole filename', () => {
    expect(parseFilename('prefix.task.1.in', 'task.*.in')).toBeNull();
    expect(parseFilename('task.1.in.suffix', 'task.*.in')).toBeNull();
  });
});
