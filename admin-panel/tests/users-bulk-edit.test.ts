import { describe, expect, it } from 'vitest';

import type { SelectedUser } from '@/components/users/bulkEditActions';
import { collectCredentialUpdates } from '@/components/users/bulkEditActions';
import { countUnreachableSelection } from '@/components/users/useUserSelection';

function selectedUser(id: number, username: string): SelectedUser {
  return { id, first_name: `First${id}`, last_name: 'Last', username, password: null };
}

describe('bulk credential change collection', () => {
  it('sends nothing when the selection is untouched, so apply performs no write', () => {
    const baseline = [selectedUser(1, 'alice'), selectedUser(2, 'bob')];

    expect(collectCredentialUpdates(baseline, baseline)).toEqual([]);
  });

  it('sends only the row whose username was regenerated', () => {
    const baseline = [selectedUser(1, 'alice'), selectedUser(2, 'bob')];
    const rows = [selectedUser(1, 'alice'), { ...selectedUser(2, 'bob'), username: 'bobx9f2' }];

    expect(collectCredentialUpdates(rows, baseline)).toEqual([{ id: 2, username: 'bobx9f2', password: null }]);
  });

  it('carries a regenerated password for the row that has one', () => {
    const baseline = [selectedUser(1, 'alice'), selectedUser(2, 'bob')];
    const rows = [selectedUser(1, 'alice'), { ...selectedUser(2, 'bob'), password: 'freshSecret' }];

    expect(collectCredentialUpdates(rows, baseline)).toEqual([{ id: 2, username: 'bob', password: 'freshSecret' }]);
  });

  it('ignores a row the baseline never held and that has no password to save', () => {
    const baseline = [selectedUser(1, 'alice')];

    expect(collectCredentialUpdates([...baseline, selectedUser(9, 'ghost')], baseline)).toEqual([]);
  });
});

describe('unreachable selection counting', () => {
  it('reports selected ids that no fetched page could resolve', () => {
    expect(countUnreachableSelection(3, 2)).toBe(1);
    expect(countUnreachableSelection(2, 2)).toBe(0);
  });

  it('never reports a negative count when the cache holds more rows than the selection', () => {
    expect(countUnreachableSelection(1, 4)).toBe(0);
  });
});
