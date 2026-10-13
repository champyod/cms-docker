'use client';

import { useEffect, useMemo } from 'react';

import { useListSession } from '@/hooks/useListSession';

export interface ListSelection {
  readonly selectedIds: ReadonlySet<number>;
  readonly selectedCount: number;
  readonly allSelected: boolean;
  readonly someSelected: boolean;
  readonly toggleAll: (checked: boolean) => void;
  readonly toggleOne: (id: number, checked: boolean) => void;
  readonly clear: () => void;
}

/**
 * Numeric-id selection over the shared, route-keyed session store.
 *
 * Why here and not per list: the store below already persists a selection across
 * opening a record and coming back; this adapts it to the numeric ids every list
 * uses, so each new selectable table adds rows, not another selection model.
 */
export function useListSelection(
  routeId: string,
  visibleIds: readonly number[],
  availableIds: readonly number[] = visibleIds,
): ListSelection {
  const { selectedIds: sessionIds, setSelected, clear, restore } = useListSession(routeId);

  // Why the joined key: the id arrays are rebuilt every render, so keying the
  // restore on their contents keeps it from pruning on each pass.
  const availableKey = availableIds.join(',');

  useEffect(() => {
    restore(availableKey === '' ? [] : availableKey.split(','));
  }, [availableKey, restore]);

  const selectedIds = useMemo(
    () => new Set([...sessionIds].map((id) => Number(id))),
    [sessionIds],
  );

  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someSelected = visibleIds.some((id) => selectedIds.has(id));

  return {
    selectedIds,
    selectedCount: selectedIds.size,
    allSelected,
    someSelected,
    toggleAll: (checked) => {
      visibleIds.forEach((id) => setSelected(String(id), checked));
    },
    toggleOne: (id, checked) => {
      setSelected(String(id), checked);
    },
    clear,
  };
}
