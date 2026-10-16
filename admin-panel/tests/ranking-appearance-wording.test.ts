import { describe, expect, it } from 'vitest';

import {
  assertWordingHasContest,
  parseContestId,
  readWording,
  wordingOverrides,
} from '@/lib/ranking-appearance';

describe('ranking appearance wording', () => {
  it('keys the override by the contest the settings name', () => {
    expect(wordingOverrides({ contestId: '9', title: 'Day Two', subtitle: 'Round two' })).toEqual({
      '9': { title: 'Day Two', subtitle: 'Round two' },
    });
  });

  it('stores no override when the operator wrote none', () => {
    expect(wordingOverrides({ contestId: '9', title: '  ', subtitle: '' })).toBeNull();
  });

  it('reads back only the words written for the named contest', () => {
    const stored = { '3': { title: 'ครั้งที่ 1', subtitle: 'วันที่ 1' } };

    expect(readWording(stored, '9')).toEqual({ title: '', subtitle: '' });
    expect(readWording(stored, '3')).toEqual({ title: 'ครั้งที่ 1', subtitle: 'วันที่ 1' });
    expect(readWording(stored, '')).toEqual({ title: '', subtitle: '' });
  });

  it('tolerates a hand-edited column rather than throwing on it', () => {
    expect(readWording('not a map', '9')).toEqual({ title: '', subtitle: '' });
    expect(readWording({ '9': { title: 42 } }, '9')).toEqual({ title: '', subtitle: '' });
  });

  it('refuses words that name no contest rather than storing them flat again', () => {
    const words = { contestId: '', title: 'Day Two', subtitle: '' };

    expect(() => assertWordingHasContest(words, null)).toThrow(
      'name the contest the wording is for',
    );
    expect(() =>
      assertWordingHasContest({ contestId: '', title: '', subtitle: '' }, null),
    ).not.toThrow();
    expect(() => assertWordingHasContest({ contestId: '9', title: 'Day Two', subtitle: '' }, 9)).not.toThrow();
  });

  it('reads the contest id the form holds, refusing anything that is not one', () => {
    expect(parseContestId(' 9 ')).toBe(9);
    expect(parseContestId('')).toBeNull();
    expect(() => parseContestId('d2')).toThrow('the contest must be one from the list');
    expect(() => parseContestId('0')).toThrow('the contest must be one from the list');
  });
});
