import { describe, expect, it } from 'vitest';

import { selectSubmission } from '@/components/submissions/submissionSelection';

interface Row {
  id: number;
  score: number | null;
  compilation_outcome: string | null;
}

const openRow: Row = { id: 8, score: 50, compilation_outcome: 'ok' };
const otherRow: Row = { id: 7, score: 100, compilation_outcome: 'ok' };

describe('selectSubmission', () => {
  it('resolves the selected id against the list it is given', () => {
    expect(selectSubmission([otherRow, openRow], 8)).toBe(openRow);
  });

  it('returns the refreshed row after a recalculation clears the results', () => {
    const before = [otherRow, openRow];
    const recalculated: Row = { id: 8, score: null, compilation_outcome: null };
    const after = [otherRow, recalculated];

    const opened = selectSubmission(before, 8);
    const now = selectSubmission(after, 8);

    expect(opened?.score).toBe(50);
    expect(now?.score).toBeNull();
    expect(now).not.toBe(opened);
  });

  it('returns null when nothing is selected', () => {
    expect(selectSubmission([otherRow], null)).toBeNull();
  });

  it('returns null when the refreshed list no longer holds the id', () => {
    expect(selectSubmission([otherRow], 8)).toBeNull();
  });
});
