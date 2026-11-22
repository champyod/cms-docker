'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';

import { TableToolbar } from '@/components/core/TableToolbar';
import { useAppRouter } from '@/hooks/useAppRouter';

export interface ContestListToolbarProps {
  /** The term the server read from the URL, so a reload keeps what the reader typed. */
  readonly initialSearch: string;
}

// Why the filter writes the query string instead of filtering in memory: the server pages the
// contests, so a filter that only hid rows on the current page would report a count against the
// page rather than against the whole set.
export function ContestListToolbar({ initialSearch }: ContestListToolbarProps): React.JSX.Element {
  const [draft, setDraft] = useState(initialSearch);
  const pathname = usePathname();
  const router = useAppRouter();

  const submit = (): void => {
    const params = new URLSearchParams(window.location.search);
    const term = draft.trim();
    if (term === '') params.delete('search');
    else params.set('search', term);
    // A narrower set makes the old page number meaningless.
    params.delete('page');
    const query = params.toString();
    router.replace(query.length > 0 ? `${pathname}?${query}` : pathname);
  };

  return (
    <TableToolbar
      searchText={draft}
      onSearchTextChange={setDraft}
      onSearchSubmit={submit}
      searchPlaceholder="Search contests…"
    />
  );
}
