export type LineDiffKind = 'same' | 'added' | 'removed';

export interface LineDiffRow {
  readonly kind: LineDiffKind;
  readonly leftNumber: number | null;
  readonly rightNumber: number | null;
  readonly left: string | null;
  readonly right: string | null;
}

const MAX_DIFF_CELLS = 1_000_000;

function splitLines(text: string): string[] {
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function sameRow(text: string, leftNumber: number, rightNumber: number): LineDiffRow {
  return { kind: 'same', leftNumber, rightNumber, left: text, right: text };
}

function removedRow(text: string, leftNumber: number): LineDiffRow {
  return { kind: 'removed', leftNumber, rightNumber: null, left: text, right: null };
}

function addedRow(text: string, rightNumber: number): LineDiffRow {
  return { kind: 'added', leftNumber: null, rightNumber, left: null, right: text };
}

interface Anchored {
  readonly prefixLength: number;
  readonly leftMiddle: readonly string[];
  readonly rightMiddle: readonly string[];
  readonly suffix: readonly string[];
}

// Why anchoring first: a submission usually shares a long head and tail with the
// previous one, and trimming them keeps the quadratic middle small enough for
// the bounded table below to stay cheap.
function anchor(left: readonly string[], right: readonly string[]): Anchored {
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < left.length - prefix
    && suffix < right.length - prefix
    && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return {
    prefixLength: prefix,
    leftMiddle: left.slice(prefix, left.length - suffix),
    rightMiddle: right.slice(prefix, right.length - suffix),
    suffix: left.slice(left.length - suffix),
  };
}

// Why the guard: the table is quadratic, so an enormous unrelated pair falls back
// to marking the whole middle as one removal block and one addition block rather
// than allocating a table that would exhaust the request.
function middleRows(
  left: readonly string[],
  right: readonly string[],
  leftOffset: number,
  rightOffset: number,
): LineDiffRow[] {
  if (left.length === 0 || right.length === 0 || left.length * right.length > MAX_DIFF_CELLS) {
    return [
      ...left.map((line, index) => removedRow(line, leftOffset + index + 1)),
      ...right.map((line, index) => addedRow(line, rightOffset + index + 1)),
    ];
  }
  const widths = right.length + 1;
  const table = new Int32Array((left.length + 1) * widths);
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i * widths + j] = left[i] === right[j]
        ? table[(i + 1) * widths + (j + 1)] + 1
        : Math.max(table[(i + 1) * widths + j], table[i * widths + (j + 1)]);
    }
  }
  const rows: LineDiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      rows.push(sameRow(left[i], leftOffset + i + 1, rightOffset + j + 1));
      i += 1;
      j += 1;
    } else if (table[(i + 1) * widths + j] >= table[i * widths + (j + 1)]) {
      rows.push(removedRow(left[i], leftOffset + i + 1));
      i += 1;
    } else {
      rows.push(addedRow(right[j], rightOffset + j + 1));
      j += 1;
    }
  }
  while (i < left.length) {
    rows.push(removedRow(left[i], leftOffset + i + 1));
    i += 1;
  }
  while (j < right.length) {
    rows.push(addedRow(right[j], rightOffset + j + 1));
    j += 1;
  }
  return rows;
}

/** Aligns the lines of two sources into a two-column row list for a side-by-side diff. */
export function diffLines(leftText: string, rightText: string): readonly LineDiffRow[] {
  const left = splitLines(leftText);
  const right = splitLines(rightText);
  const { prefixLength, leftMiddle, rightMiddle, suffix } = anchor(left, right);
  const rows: LineDiffRow[] = [];
  for (let index = 0; index < prefixLength; index += 1) {
    rows.push(sameRow(left[index], index + 1, index + 1));
  }
  rows.push(...middleRows(leftMiddle, rightMiddle, prefixLength, prefixLength));
  const leftSuffixStart = prefixLength + leftMiddle.length;
  const rightSuffixStart = prefixLength + rightMiddle.length;
  for (let index = 0; index < suffix.length; index += 1) {
    rows.push(sameRow(suffix[index], leftSuffixStart + index + 1, rightSuffixStart + index + 1));
  }
  return rows;
}
