'use client';

import { useEffect, useMemo, useState } from 'react';

import { useListSession } from '@/hooks/useListSession';

export interface ListSelection {
  readonly selectedIds: ReadonlySet<number>;
  readonly selectedCount: number;
  readonly allSelected: boolean;
  readonly someSelected: boolean;
  /** The row the last plain toggle touched; a shift-range is measured from it. */
  readonly anchorId: number | null;
  readonly toggleAll: (checked: boolean) => void;
  readonly toggleOne: (id: number, checked: boolean) => void;
  /**
   * Sets the whole anchor-to-current span to the anchor's own state, and reports
   * whether a span was actually applied — a caller uses the answer to suppress the
   * click that would otherwise toggle the end row a second time.
   */
  readonly toggleRange: (anchorId: number, currentId: number) => boolean;
  readonly clear: () => void;
}

/** The ids from anchor to current in visible order, or null when either end is off-page. */
function rangeBetween(
  visibleIds: readonly number[],
  anchorId: number,
  currentId: number,
): readonly number[] | null {
  const from = visibleIds.indexOf(anchorId);
  const to = visibleIds.indexOf(currentId);
  if (from === -1 || to === -1) return null;
  return from <= to ? visibleIds.slice(from, to + 1) : visibleIds.slice(to, from + 1);
}

/**
 * Numeric-id selection over the shared, route-keyed session store.
 *
 * Why here and not per list: the store below already persists a selection across
 * opening a record and coming back; this adapts it to the numeric ids every list
 * uses, so each new selectable table adds rows, not another selection model.
 *
 * The shift-range is additive: nothing changes for a consumer that never calls
 * toggleRange, and a shift-click with no anchor falls back to a plain toggle.
 */
export function useListSelection(
  routeId: string,
  visibleIds: readonly number[],
  availableIds: readonly number[] = visibleIds,
): ListSelection {
  const { selectedIds: sessionIds, setSelected, clear, restore } = useListSession(routeId);
  const [anchorId, setAnchorId] = useState<number | null>(null);

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
    anchorId,
    toggleAll: (checked) => {
      visibleIds.forEach((id) => setSelected(String(id), checked));
    },
    toggleOne: (id, checked) => {
      setSelected(String(id), checked);
      setAnchorId(id);
    },
    toggleRange: (anchor, current) => {
      const span = rangeBetween(visibleIds, anchor, current);
      if (span === null || span.length < 2) return false;
      const target = selectedIds.has(anchor);
      span.forEach((id) => setSelected(String(id), target));
      setAnchorId(current);
      return true;
    },
    clear: () => {
      clear();
      setAnchorId(null);
    },
  };
}
