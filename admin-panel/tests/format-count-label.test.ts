import { describe, expect, it } from 'vitest';
import { countLabel } from '@/lib/format-number';

const noun = { one: 'task', other: 'tasks' };

describe('countLabel', () => {
  it('uses the singular noun for exactly one', () => {
    expect(countLabel(1, noun)).toBe('1 task');
  });

  it('uses the other noun for zero, because a count of none is still a plural in English', () => {
    expect(countLabel(0, noun)).toBe('0 tasks');
  });

  it('groups the number and uses the other noun above one', () => {
    expect(countLabel(1204, noun)).toBe('1,204 tasks');
  });

  // Why: a language without plurals passes the same word twice, and the helper must not double it.
  it('accepts a language that does not pluralise', () => {
    expect(countLabel(3, { one: 'งาน', other: 'งาน' }, 'th')).toBe('3 งาน');
  });
});
