import { useState } from 'react';

interface UseTableOptions {
  initialPage?: number;
  initialPerPage?: number;
  initialSearch?: string;
}

export function useTable(options: UseTableOptions = {}) {
  const [page, setPage] = useState(options.initialPage ?? 1);
  const [perPage, setPerPage] = useState(options.initialPerPage ?? 20);
  const [search, setSearch] = useState(options.initialSearch ?? '');

  return {
    page,
    perPage,
    search,
    setPage,
    setPerPage,
    setSearch,
  };
}
