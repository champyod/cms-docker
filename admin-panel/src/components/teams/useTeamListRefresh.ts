'use client';

import { useCallback, useEffect } from 'react';

// Why a module handle: the page header that owns the create dialog renders in a different client
// tree from the table it has to reload, so the two cannot share a prop. One handle serves the team
// list, and a header unmounting simply stops calling it.
let refreshImpl: (() => void) | null = null;

/** Re-reads the team list after a header-owned dialog saves. */
export function useTeamListRefresh(): () => void {
  return useCallback((): void => {
    refreshImpl?.();
  }, []);
}

// Why registered in an effect: the table is the only place that holds the current query, so it
// advertises the refresh; a render that never commits effects never advertises one nobody can call.
export function useRegisterTeamListRefresh(refresh: () => void): void {
  useEffect(() => {
    refreshImpl = refresh;
    return (): void => {
      refreshImpl = null;
    };
  }, [refresh]);
}
