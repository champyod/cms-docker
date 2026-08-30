'use client';

import { useEffect, useRef, useState } from 'react';
import { MIN_QUERY_LENGTH, SEARCH_DEBOUNCE_MS, createSearchScheduler, type SearchScheduler } from './search-scheduler';
import type { EntityHit, EntitySearcher } from './entity-searchers';

export interface EntitySearchState {
  loading: boolean;
  hits: EntityHit[];
}

async function runEntitySearch(
  searchers: EntitySearcher[],
  query: string,
  signal: AbortSignal,
): Promise<EntityHit[]> {
  const batches = await Promise.all(searchers.map((searcher) => searcher(query, signal).catch(() => [])));
  return batches.flat();
}

export function useEntitySearch(open: boolean, query: string, searchers: EntitySearcher[]): EntitySearchState {
  const [state, setState] = useState<EntitySearchState>({ loading: false, hits: [] });
  const schedulerRef = useRef<SearchScheduler | null>(null);

  useEffect(() => {
    const scheduler = createSearchScheduler(SEARCH_DEBOUNCE_MS);
    schedulerRef.current = scheduler;
    return () => scheduler.cancel();
  }, []);

  useEffect(() => {
    const scheduler = schedulerRef.current;
    if (!scheduler) return;

    const trimmed = query.trim();
    const shouldSearch = open && searchers.length > 0 && trimmed.length >= MIN_QUERY_LENGTH;

    scheduler.schedule(async (signal) => {
      if (!shouldSearch) {
        setState({ loading: false, hits: [] });
        return;
      }
      setState((previous) => ({ loading: true, hits: previous.hits }));
      const hits = await runEntitySearch(searchers, trimmed, signal);
      if (signal.aborted) return;
      setState({ loading: false, hits });
    });
  }, [open, query, searchers]);

  return state;
}
