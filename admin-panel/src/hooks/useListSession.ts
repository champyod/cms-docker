'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const SESSION_KEY_PREFIX = 'cms:list:';

export interface ListSession {
  readonly selectedIds: ReadonlySet<string>;
  readonly isSelected: (id: string) => boolean;
  readonly setSelected: (id: string, selected: boolean) => void;
  readonly clear: () => void;
  readonly restore: (availableIds: readonly string[]) => void;
  readonly setPanelOpen: (open: boolean) => void;
}

/**
 * Why the route id and not the pathname: two locales are the same list, and a
 * record tab under the same list must inherit the same selection, so the key has
 * to be the canonical route identity the registry already declares.
 */
export function listSessionKey(routeId: string): string {
  return `${SESSION_KEY_PREFIX}${routeId}`;
}

function readStoredIds(storageKey: string): string[] {
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    // Why a fall back rather than a throw: a session written by an older build is
    // a stale value, and a list that refuses to render over it is worse than a
    // list that starts with nothing selected.
    return [];
  }
}

function writeStoredIds(storageKey: string, ids: ReadonlySet<string>): void {
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify([...ids]));
  } catch {
    // Why swallowed: a full or disabled session store costs the reader their
    // selection across a refresh, which is recoverable, and a throw here would
    // take the whole list down with it.
  }
}

function withoutId(previous: ReadonlySet<string>, id: string, selected: boolean): ReadonlySet<string> {
  const next = new Set(previous);
  if (selected) next.add(id);
  else next.delete(id);
  return next;
}

/**
 * Selection that survives leaving a list and coming back, keyed by route id.
 *
 * Why a session store and not component state: a list that keeps its rows in
 * local state loses every checked box the moment a record tab opens, and the
 * reader has to find them all again on the way back.
 */
export function useListSession(routeId: string): ListSession {
  const storageKey = listSessionKey(routeId);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set(readStoredIds(storageKey)));
  const isPanelOpenRef = useRef(false);

  useEffect(() => {
    writeStoredIds(storageKey, selectedIds);
  }, [selectedIds, storageKey]);

  const setSelected = useCallback((id: string, selected: boolean): void => {
    setSelectedIds((previous) => withoutId(previous, id, selected));
  }, []);

  const clear = useCallback((): void => {
    setSelectedIds(new Set());
  }, []);

  const isSelected = useCallback((id: string): boolean => selectedIds.has(id), [selectedIds]);

  /**
   * Keeps only the ids the current rows can still resolve. A record deleted while
   * the reader was away would otherwise stay checked and be handed to a bulk
   * action that no longer has a row to act on.
   *
   * Why it stands down while a side panel is open: the panel is showing one
   * record's context over a list that is still fully loaded, so filtering the
   * selection against the panel's narrower row set would clear the list behind it
   * on the way to reading a detail.
   */
  const restore = useCallback((availableIds: readonly string[]): void => {
    if (isPanelOpenRef.current) return;
    const available = new Set(availableIds);
    setSelectedIds((previous) => {
      const next = new Set([...previous].filter((id) => available.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, []);

  const setPanelOpen = useCallback((open: boolean): void => {
    isPanelOpenRef.current = open;
  }, []);

  return useMemo(
    () => ({ selectedIds, isSelected, setSelected, clear, restore, setPanelOpen }),
    [selectedIds, isSelected, setSelected, clear, restore, setPanelOpen],
  );
}
