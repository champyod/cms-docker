'use client';

import { useCallback, useState } from 'react';

export interface ContainerSelection {
  selectedIds: Set<string>;
  selectedCount: number;
  toggle: (containerId: string) => void;
  clear: () => void;
  has: (containerId: string) => boolean;
}

export function useContainerSelection(): ContainerSelection {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggle = useCallback((containerId: string): void => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(containerId)) next.delete(containerId);
      else next.add(containerId);
      return next;
    });
  }, []);

  const clear = useCallback((): void => {
    setSelectedIds(new Set());
  }, []);

  const has = useCallback(
    (containerId: string): boolean => selectedIds.has(containerId),
    [selectedIds],
  );

  return { selectedIds, selectedCount: selectedIds.size, toggle, clear, has };
}
