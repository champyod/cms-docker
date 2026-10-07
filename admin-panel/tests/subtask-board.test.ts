import { describe, expect, it } from 'vitest';
import {
  buildUploadSubtaskRows,
  deriveSubtaskRegex,
  groupsFromRows,
  poolFromGroups,
  rowsFromGroups,
} from '@/components/tasks/subtask-board';
import type { SubtaskRow } from '@/components/tasks/dataset-score-params';

const TESTCASES = ['subtask1_01', 'subtask1_02', 'subtask2_01', 'tc3'];

describe('groupsFromRows', () => {
  it('matches regex rows against codenames from the start', () => {
    const rows: SubtaskRow[] = [
      { maxScore: '40', testcases: 'subtask1_.*', threshold: '1' },
      { maxScore: '60', testcases: 'subtask2_.*', threshold: '1' },
    ];
    const groups = groupsFromRows(rows, TESTCASES);
    expect(groups[0].testcases).toEqual(['subtask1_01', 'subtask1_02']);
    expect(groups[1].testcases).toEqual(['subtask2_01']);
  });

  it('slices sorted codenames for count rows like the CMS does', () => {
    const rows: SubtaskRow[] = [
      { maxScore: '50', testcases: '2', threshold: '1' },
      { maxScore: '50', testcases: '2', threshold: '1' },
    ];
    const groups = groupsFromRows(rows, TESTCASES);
    expect(groups[0].testcases).toEqual(['subtask1_01', 'subtask1_02']);
    expect(groups[1].testcases).toEqual(['subtask2_01', 'tc3']);
  });

  it('leaves unmatched codenames in the pool', () => {
    const rows: SubtaskRow[] = [
      { maxScore: '40', testcases: 'subtask1_.*', threshold: '1' },
    ];
    expect(poolFromGroups(groupsFromRows(rows, TESTCASES), TESTCASES)).toEqual(['subtask2_01', 'tc3']);
  });
});

describe('deriveSubtaskRegex', () => {
  it('uses a prefix shorthand when every prefixed codename is in the group', () => {
    expect(deriveSubtaskRegex(['subtask1_01', 'subtask1_02'], TESTCASES)).toBe('subtask1_.*');
  });

  it('falls back to an exact alternation when the prefix would capture more', () => {
    expect(deriveSubtaskRegex(['subtask1_01'], TESTCASES)).toBe('^(?:subtask1_01)$');
  });

  it('escapes metacharacters in the alternation', () => {
    expect(deriveSubtaskRegex(['a.b', 'c+d'], ['a.b', 'c+d'])).toBe('^(?:a\\.b|c\\+d)$');
  });
});

describe('rowsFromGroups', () => {
  it('roundtrips groups back to score rows', () => {
    const rows: SubtaskRow[] = [
      { maxScore: '40', testcases: 'subtask1_.*', threshold: '1' },
      { maxScore: '60', testcases: 'subtask2_.*', threshold: '1' },
    ];
    const groups = groupsFromRows(rows, TESTCASES);
    expect(rowsFromGroups(groups, TESTCASES)).toEqual([
      { maxScore: '40', testcases: 'subtask1_.*', threshold: '1' },
      { maxScore: '60', testcases: 'subtask2_.*', threshold: '1' },
    ]);
  });

  it('canonicalizes a lone prefixed codename to the prefix shorthand', () => {
    const rows: SubtaskRow[] = [
      { maxScore: '60', testcases: '^(?:subtask2_01)$', threshold: '1' },
    ];
    const groups = groupsFromRows(rows, TESTCASES);
    expect(rowsFromGroups(groups, TESTCASES)[0].testcases).toBe('subtask2_.*');
  });
});

describe('buildUploadSubtaskRows', () => {
  it('splits the points evenly with the remainder up front', () => {
    const rows = buildUploadSubtaskRows([
      { name: 'subtask1', testcases: ['subtask1_01', 'subtask1_02'] },
      { name: 'subtask2', testcases: ['subtask2_01'] },
      { name: 'subtask3', testcases: ['tc3'] },
    ], TESTCASES, 100);
    expect(rows.map((row) => row.maxScore)).toEqual(['34', '33', '33']);
    expect(rows[0].testcases).toBe('subtask1_.*');
  });
});
