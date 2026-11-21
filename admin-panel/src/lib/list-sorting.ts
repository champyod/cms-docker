export type SortDirection = 'asc' | 'desc';

export interface ListSort {
  readonly key: string;
  readonly direction: SortDirection;
}

export type ListSortInput = ListSort | null | undefined;

interface SortQuery {
  readonly sort?: string;
  readonly dir?: string;
}

// Why a cycle and not a toggle: a third state returns the list to the order the
// server chose, so a reader who sorts twice can always get back to the default.
export function toggleListSort(current: ListSortInput, key: string): ListSortInput {
  if (current == null || current.key !== key) return { key, direction: 'asc' };
  if (current.direction === 'asc') return { key, direction: 'desc' };
  return null;
}

export function readListSort(query: SortQuery): ListSortInput {
  const key = query.sort?.trim();
  if (!key) return null;
  const direction: SortDirection = query.dir === 'desc' ? 'desc' : 'asc';
  return { key, direction };
}

export function listSortQuery(sort: ListSortInput): SortQuery {
  if (sort == null) return {};
  return { sort: sort.key, dir: sort.direction };
}

export function ariaSortFor(sort: ListSortInput, key: string): 'ascending' | 'descending' | 'none' {
  if (sort == null || sort.key !== key) return 'none';
  return sort.direction === 'asc' ? 'ascending' : 'descending';
}
