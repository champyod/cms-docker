import { describe, expect, it } from 'vitest';
import { parseFilename, parseFilenameWithSubtask, parseSubtaskPrefix, validatePattern } from '@/utils/filenameParser';

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

describe('validatePattern', () => {
  it('accepts star and double-star patterns', () => {
    expect(validatePattern('*.in')).toBe('');
    expect(validatePattern('prob_**.out')).toBe('');
  });

  it('rejects empty and starless patterns', () => {
    expect(validatePattern('')).toContain('empty');
    expect(validatePattern('fixed.txt')).toContain('*');
  });
});

describe('parseFilenameWithSubtask', () => {
  it('keeps plain numeric codenames unchanged', () => {
    expect(parseFilenameWithSubtask('01.in', '*.in')).toBe('01');
    expect(parseFilenameWithSubtask('task.12.in', 'task.*.in')).toBe('12');
  });

  it('keeps the full stem when a subtask prefix is present', () => {
    expect(parseFilenameWithSubtask('subtask1_01.in', '*.in')).toBe('subtask1_01');
    expect(parseFilenameWithSubtask('st2-03.out', '*.out')).toBe('st2-03');
    expect(parseFilenameWithSubtask('group1_007.in', '**.in')).toBeNull();
    expect(parseFilenameWithSubtask('group1_07.in', '**.in')).toBe('group1_07');
  });

  it('still rejects filenames with no numeric id', () => {
    expect(parseFilenameWithSubtask('subtask.in', '*.in')).toBeNull();
    expect(parseFilenameWithSubtask('subtask1.in', '*.in')).toBeNull();
    expect(parseFilenameWithSubtask('readme.txt', '*.in')).toBeNull();
  });
});

describe('parseSubtaskPrefix', () => {
  it('extracts the prefix of a subtask-named codename', () => {
    expect(parseSubtaskPrefix('subtask1_01')).toBe('subtask1');
    expect(parseSubtaskPrefix('st2-03')).toBe('st2');
  });

  it('returns null for plain numeric codenames', () => {
    expect(parseSubtaskPrefix('01')).toBeNull();
    expect(parseSubtaskPrefix('task.12')).toBeNull();
    expect(parseSubtaskPrefix('subtask_')).toBeNull();
  });
});
