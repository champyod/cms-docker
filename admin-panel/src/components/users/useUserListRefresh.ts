'use client';

import { useCallback, useEffect } from 'react';

// Why a module handle: the page header that owns the create dialogs renders in a
// different client tree from the list it has to reload, so the two cannot share a
// prop. One handle serves every user list, and a header unmounting simply stops
// calling it — the list keeps the only `fetchUsers` that knows the current query.
let refreshImpl: (() => void) | null = null;

/** Re-reads the user list after a header-owned dialog saves. */
export function useUserListRefresh(): () => void {
  return useCallback((): void => {
    refreshImpl?.();
  }, []);
}

// Why registered in an effect: the registrar runs where `fetchUsers` exists, so a
// render that never commits effects never advertises a refresh nobody can call.
export function useRegisterUserListRefresh(refresh: () => void): void {
  useEffect(() => {
    refreshImpl = refresh;
    return (): void => {
      refreshImpl = null;
    };
  }, [refresh]);
}