import { describe, expect, it } from 'vitest';

import { contestSortOrderBy } from '@/lib/contest-sorting';

describe('contestSortOrderBy', () => {
  it('leads the default order with the active contest', () => {
    expect(contestSortOrderBy(null)).toEqual([{ is_active: 'desc' }, { id: 'asc' }]);
  });

  it('falls back to the default order for an unknown sort key', () => {
    expect(contestSortOrderBy({ key: 'nope', direction: 'desc' })).toEqual([{ is_active: 'desc' }, { id: 'asc' }]);
  });

  it('leaves an explicit sort untouched', () => {
    expect(contestSortOrderBy({ key: 'name', direction: 'asc' })).toEqual([{ name: 'asc' }]);
    expect(contestSortOrderBy({ key: 'is_active', direction: 'asc' })).toEqual([{ is_active: 'asc' }]);
    expect(contestSortOrderBy({ key: 'participants', direction: 'desc' })).toEqual([
      { participations: { _count: 'desc' } },
    ]);
  });
});
