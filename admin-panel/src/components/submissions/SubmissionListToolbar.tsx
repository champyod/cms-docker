'use client';

import { useRouter } from 'next/navigation';

import { SubmissionFiltersCard, type SubmissionFilters } from './SubmissionFiltersCard';

/**
 * The list's narrowing controls, mounted in the list layout's toolbar slot.
 *
 * Why the address bar and not local state: a filter is a property of the view, so a shared link and
 * a reload resolve the same rows. Every change returns to page 1, because page 4 of the unfiltered
 * list is not page 4 of a narrowed one.
 */
export function SubmissionListToolbar({ filters }: { readonly filters: SubmissionFilters }): React.JSX.Element {
  const router = useRouter();

  const apply = (next: SubmissionFilters): void => {
    const url = new URL(window.location.href);
    const narrowing: readonly (readonly [string, string | number | undefined])[] = [
      ['contest', next.contestId],
      ['task', next.taskId],
      ['user', next.userId],
      ['search', next.search],
    ];
    for (const [key, value] of narrowing) {
      if (value === undefined || value === '') url.searchParams.delete(key);
      else url.searchParams.set(key, String(value));
    }
    url.searchParams.set('page', '1');
    router.push(url.toString());
  };

  return <SubmissionFiltersCard filters={filters} onApply={apply} />;
}
