interface CsvScannerState {
  current: string;
  row: string[];
  inQuotes: boolean;
}

function appendCell(state: CsvScannerState): void {
  state.row.push(state.current.trim());
  state.current = '';
}

function closeRecord(state: CsvScannerState, rows: string[][], consumeNext: boolean): boolean {
  appendCell(state);
  if (state.row.some((cell) => cell !== '')) rows.push(state.row);
  state.row = [];
  return consumeNext;
}

function processChar(char: string, next: string | undefined, state: CsvScannerState, rows: string[][]): boolean {
  if (char === '"') {
    if (state.inQuotes && next === '"') {
      state.current += '"';
      return true;
    }
    state.inQuotes = !state.inQuotes;
    return false;
  }

  if (char === ',' && !state.inQuotes) {
    appendCell(state);
    return false;
  }

  if ((char === '\n' || char === '\r') && !state.inQuotes) {
    return closeRecord(state, rows, char === '\r' && next === '\n');
  }

  state.current += char;
  return false;
}

export interface CsvFieldMismatch {
  /** 1-based position in the file, header included — matches the row numbers the panel shows. */
  rowIndex: number;
  expected: number;
  actual: number;
}

/** Why strip at the tokenizer entry: Excel prepends a BOM to every CSV it saves, and
 * the marker must never reach the scanner — where it could open or close a quoted
 * field — rather than relying on the per-cell trim to absorb it later. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  const source = stripBom(text);
  const state: CsvScannerState = { current: '', row: [], inQuotes: false };

  for (let i = 0; i < source.length; i += 1) {
    if (processChar(source[i], source[i + 1], state, rows)) i += 1;
  }

  appendCell(state);
  if (state.row.some((cell) => cell !== '')) rows.push(state.row);

  return rows;
}

/** Why compare against the header: a row with the wrong cell count silently shifts
 * every value after the break, so the operator has to be told which row is short or
 * long and by how much. */
export function detectFieldMismatches(rows: readonly string[][]): CsvFieldMismatch[] {
  const expected = rows[0]?.length ?? 0;
  const mismatches: CsvFieldMismatch[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const actual = rows[index].length;
    if (actual !== expected) {
      mismatches.push({ rowIndex: index + 1, expected, actual });
    }
  }
  return mismatches;
}

export function formatMismatch(mismatch: CsvFieldMismatch): string {
  return `Row ${mismatch.rowIndex}: expected ${mismatch.expected} fields, got ${mismatch.actual}`;
}
