import { describe, expect, it } from 'vitest';

import {
  assertWordingHasContest,
  readWording,
  wordingOverrides,
} from '@/lib/ranking-appearance';

describe('ranking appearance wording', () => {
  it('keys the override by the contest the config shows', () => {
    expect(wordingOverrides({ title: 'Day Two', subtitle: 'Round two' }, 9)).toEqual({
      '9': { title: 'Day Two', subtitle: 'Round two' },
    });
  });

  it('stores no override when the operator wrote none', () => {
    expect(wordingOverrides({ title: '  ', subtitle: '' }, 9)).toBeNull();
  });

  it('stores no override when the config shows no single contest', () => {
    expect(wordingOverrides({ title: 'Day Two', subtitle: '' }, null)).toBeNull();
  });

  it('reads back only the words written for the shown contest', () => {
    const stored = { '3': { title: 'ครั้งที่ 1', subtitle: 'วันที่ 1' } };

    expect(readWording(stored, 9)).toEqual({ title: '', subtitle: '' });
    expect(readWording(stored, 3)).toEqual({ title: 'ครั้งที่ 1', subtitle: 'วันที่ 1' });
    expect(readWording(stored, null)).toEqual({ title: '', subtitle: '' });
  });

  it('tolerates a hand-edited column rather than throwing on it', () => {
    expect(readWording('not a map', 9)).toEqual({ title: '', subtitle: '' });
    expect(readWording({ '9': { title: 42 } }, 9)).toEqual({ title: '', subtitle: '' });
  });

  it('refuses words that name no shown contest rather than storing them flat again', () => {
    const words = { title: 'Day Two', subtitle: '' };

    expect(() => assertWordingHasContest(words, null)).toThrow(
      'show exactly one contest before wording the header',
    );
    expect(() => assertWordingHasContest({ title: '', subtitle: '' }, null)).not.toThrow();
    expect(() => assertWordingHasContest(words, 9)).not.toThrow();
  });
});
