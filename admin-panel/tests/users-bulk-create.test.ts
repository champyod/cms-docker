import { describe, expect, it } from 'vitest';

import {
  blockingRowIndices,
  buildConfirmLabel,
  countSelectedBlocking,
  isPreviewStale,
  selectableRowIndices,
  selectSubmittableRows,
} from '@/components/users/bulkCreateState';
import type { PreviewRow } from '@/components/users/csvPreview';

function previewRow(rowIndex: number, issues: string[] = []): PreviewRow {
  return {
    rowIndex,
    first_name: `First${rowIndex}`,
    last_name: 'Last',
    username: `user${rowIndex}`,
    password: 'secret',
    email: '',
    timezone: '',
    team: '',
    issues,
  };
}

describe('bulk create selection gating', () => {
  it('creates only the checked rows, in preview order', () => {
    const rows = [previewRow(2), previewRow(3), previewRow(4)];

    const submittable = selectSubmittableRows(rows, new Set([2, 4]), false, new Set());

    expect(submittable.map((row) => row.rowIndex)).toEqual([2, 4]);
  });

  it('selects every parsed row after a parse so nothing is dropped by default', () => {
    const rows = [previewRow(2), previewRow(3)];

    expect([...selectableRowIndices(rows)]).toEqual([2, 3]);
  });

  it('counts a selected invalid row as blocking and names it', () => {
    const rows = [previewRow(2), previewRow(3, ['username missing'])];
    const blocking = blockingRowIndices(rows);

    expect([...blocking]).toEqual([3]);
    expect(countSelectedBlocking(rows, new Set([2, 3]), blocking)).toBe(1);
  });

  it('keeps an invalid row in the create set until it is explicitly skipped', () => {
    const rows = [previewRow(2), previewRow(3, ['username missing'])];
    const blocking = blockingRowIndices(rows);
    const selected = new Set([2, 3]);

    expect(selectSubmittableRows(rows, selected, false, blocking).map((row) => row.rowIndex)).toEqual([2, 3]);
    expect(selectSubmittableRows(rows, selected, true, blocking).map((row) => row.rowIndex)).toEqual([2]);
  });

  it('treats a row whose issues are only a field-count mismatch as blocking', () => {
    const rows = [previewRow(2, ['Row 2: expected 4 fields, got 2'])];

    expect(countSelectedBlocking(rows, new Set([2]), blockingRowIndices(rows))).toBe(1);
  });
});

describe('bulk create stale preview guard', () => {
  it('reports a draft that no longer matches the parsed text', () => {
    expect(isPreviewStale('a,b\n1,2', 'a,b\n1,2')).toBe(false);
    expect(isPreviewStale('a,b\n1,2\n3,4', 'a,b\n1,2')).toBe(true);
  });
});

describe('bulk create confirm label', () => {
  it('names how much of the parsed draft will be created', () => {
    expect(buildConfirmLabel(false, 3, 5)).toBe('Create 3 of 5 users');
  });

  it('falls back to the plain label before anything is parsed', () => {
    expect(buildConfirmLabel(false, 0, 0)).toBe('Create Users from Preview');
  });

  it('asks for a re-parse while the draft has moved on', () => {
    expect(buildConfirmLabel(true, 3, 5)).toBe('Re-parse to continue');
  });
});
