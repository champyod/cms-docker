import { describe, expect, it } from 'vitest';
import {
  convertScoreParams,
  lintSubtaskRows,
  paramsToRows,
  rowsToParams,
} from '@/components/tasks/dataset-score-params';

describe('paramsToRows', () => {
  it('returns a blank row for empty params', () => {
    expect(paramsToRows([])).toEqual([{ maxScore: '', testcases: '', threshold: '1' }]);
  });

  it('maps group entries to rows', () => {
    expect(paramsToRows([[40, 3], [60, 'subtask2_.*']])).toEqual([
      { maxScore: '40', testcases: '3', threshold: '1' },
      { maxScore: '60', testcases: 'subtask2_.*', threshold: '1' },
    ]);
  });
});

describe('rowsToParams', () => {
  it('parses numeric counts and keeps regex strings', () => {
    expect(rowsToParams([
      { maxScore: '40', testcases: '3', threshold: '1' },
      { maxScore: '60', testcases: 'subtask2_.*', threshold: '1' },
    ], 'GroupMin')).toEqual([[40, 3], [60, 'subtask2_.*']]);
  });

  it('includes threshold for GroupThreshold', () => {
    expect(rowsToParams([{ maxScore: '50', testcases: '2', threshold: '0.5' }], 'GroupThreshold'))
      .toEqual([[50, 2, 0.5]]);
  });
});

describe('lintSubtaskRows', () => {
  it('accepts valid rows', () => {
    expect(lintSubtaskRows([{ maxScore: '40', testcases: '3', threshold: '1' }], 'GroupMin')).toBe('');
  });

  it('rejects negative scores, bad counts, and out-of-range thresholds', () => {
    expect(lintSubtaskRows([{ maxScore: '-1', testcases: '3', threshold: '1' }], 'GroupMin')).toContain('max score');
    expect(lintSubtaskRows([{ maxScore: '40', testcases: '0', threshold: '1' }], 'GroupMin')).toContain('count');
    expect(lintSubtaskRows([{ maxScore: '40', testcases: '2', threshold: '2' }], 'GroupThreshold')).toContain('threshold');
    expect(lintSubtaskRows([{ maxScore: '40', testcases: '([', threshold: '1' }], 'GroupMin')).toContain('regular expression');
  });
});

describe('convertScoreParams', () => {
  it('sums group scores when switching to Sum', () => {
    expect(convertScoreParams([[40, 3], [60, 2]], 'GroupMin', 'Sum')).toBe(100);
  });

  it('expands a Sum multiplier into a single group row', () => {
    expect(convertScoreParams(100, 'Sum', 'GroupMin')).toEqual([[100, 1]]);
  });

  it('adds a default threshold when switching to GroupThreshold', () => {
    expect(convertScoreParams([[40, 3]], 'GroupMin', 'GroupThreshold')).toEqual([[40, 3, 1]]);
  });
});
