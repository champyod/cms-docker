import type { PreviewRow } from './csvPreview';

/** Switches the confirm label only once there is something to count. */
export function buildConfirmLabel(stalePreview: boolean, submittableCount: number, parsedCount: number): string {
  if (stalePreview) return 'Re-parse to continue';
  if (parsedCount === 0) return 'Create Users from Preview';
  return `Create ${submittableCount} of ${parsedCount} users`;
}

/** Whether the draft the reader is editing has moved on from the one that was parsed. */
export function isPreviewStale(csvText: string, parsedText: string): boolean {
  return csvText !== parsedText;
}

/**
 * Why a non-empty issue list is the blocking set: every issue the parser records —
 * a missing required field or a row whose field count differs from the header — is
 * something the create endpoint refuses, so the reader must see it before submitting
 * rather than as a per-row failure afterwards.
 */
export function blockingRowIndices(rows: readonly PreviewRow[]): Set<number> {
  const blocking = new Set<number>();
  rows.forEach((row) => {
    if (row.issues.length > 0) blocking.add(row.rowIndex);
  });
  return blocking;
}

export function selectableRowIndices(rows: readonly PreviewRow[]): Set<number> {
  return new Set(rows.map((row) => row.rowIndex));
}

export function countSelectedBlocking(
  rows: readonly PreviewRow[],
  selectedRowIndices: ReadonlySet<number>,
  blocking: ReadonlySet<number>,
): number {
  return rows.filter((row) => selectedRowIndices.has(row.rowIndex) && blocking.has(row.rowIndex)).length;
}

/**
 * Why the selection is the create set: the checkboxes are the only place the reader
 * can say "not this one", so a row they are not selected on must never be written.
 * Skipping invalid rows stays an explicit choice, so the default keeps them in view
 * and lets the confirm button stay disabled until the reader decides.
 */
export function selectSubmittableRows(
  rows: readonly PreviewRow[],
  selectedRowIndices: ReadonlySet<number>,
  skipInvalid: boolean,
  blocking: ReadonlySet<number>,
): PreviewRow[] {
  return rows.filter((row) => {
    if (!selectedRowIndices.has(row.rowIndex)) return false;
    return !(skipInvalid && blocking.has(row.rowIndex));
  });
}
