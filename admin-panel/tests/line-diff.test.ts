import { describe, expect, it } from 'vitest';

import { diffLines } from '@/lib/line-diff';

const kinds = (text: string, other: string): string[] => diffLines(text, other).map((row) => row.kind);

describe('line diff', () => {
  it('marks identical sources as every line unchanged', () => {
    const rows = diffLines('a\nb\nc', 'a\nb\nc');

    expect(rows.map((row) => row.kind)).toEqual(['same', 'same', 'same']);
    expect(rows.map((row) => row.leftNumber)).toEqual([1, 2, 3]);
    expect(rows.map((row) => row.rightNumber)).toEqual([1, 2, 3]);
  });

  it('reports an inserted line without shifting the surrounding lines', () => {
    const rows = diffLines('a\nc', 'a\nb\nc');

    expect(rows.map((row) => row.kind)).toEqual(['same', 'added', 'same']);
    expect(rows[1]).toMatchObject({ left: null, right: 'b', leftNumber: null, rightNumber: 2 });
    expect(rows[2]).toMatchObject({ left: 'c', right: 'c', leftNumber: 2, rightNumber: 3 });
  });

  it('reports a removed line', () => {
    const rows = diffLines('a\nb\nc', 'a\nc');

    expect(rows.map((row) => row.kind)).toEqual(['same', 'removed', 'same']);
    expect(rows[1]).toMatchObject({ left: 'b', right: null, leftNumber: 2, rightNumber: null });
  });

  it('reports a changed line as the removal and the addition it replaced', () => {
    const rows = diffLines('a\nold\nc', 'a\nnew\nc');

    expect(rows.map((row) => row.kind)).toEqual(['same', 'removed', 'added', 'same']);
    expect(rows[1]).toMatchObject({ left: 'old', leftNumber: 2 });
    expect(rows[2]).toMatchObject({ right: 'new', rightNumber: 2 });
  });

  it('treats an empty side as only additions or only removals', () => {
    expect(kinds('', 'x\ny')).toEqual(['added', 'added']);
    expect(kinds('x\ny', '')).toEqual(['removed', 'removed']);
    expect(diffLines('', '')).toEqual([]);
  });

  it('treats a trailing newline as the end of the last line rather than an extra line', () => {
    expect(diffLines('a\nb\n', 'a\nb')).toEqual(diffLines('a\nb', 'a\nb'));
  });

  it('numbers the shared tail from each side after unequal middles', () => {
    const rows = diffLines('a\nb\nc', 'a\nc');

    expect(rows[2]).toMatchObject({ kind: 'same', left: 'c', right: 'c', leftNumber: 3, rightNumber: 2 });
  });

  it('falls back to whole-block replacement when the middle is too large to align', () => {
    const left = Array.from({ length: 1001 }, (_, index) => 'L' + index).join('\n');
    const right = Array.from({ length: 1001 }, (_, index) => 'R' + index).join('\n');

    const rows = diffLines(left, right);

    expect(rows).toHaveLength(2002);
    expect(rows.filter((row) => row.kind === 'removed')).toHaveLength(1001);
    expect(rows.filter((row) => row.kind === 'added')).toHaveLength(1001);
  });
});
