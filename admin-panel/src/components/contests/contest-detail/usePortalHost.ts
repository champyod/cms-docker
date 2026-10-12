'use client';

import { useSyncExternalStore } from 'react';

/**
 * The element a panel is portalled into, or null while the page is rendered on the server.
 *
 * The snapshot is the host itself rather than a boolean, so a consumer needs no second piece of
 * state to gate the portal and no component has to set state from an effect. The answer cannot
 * change after hydration, so the store never has a reason to notify anyone.
 */
export function usePortalHost(): HTMLElement | null {
  return useSyncExternalStore(subscribe, readPortalHost, () => null);
}

function subscribe(_onStoreChange: () => void): () => void {
  return () => undefined;
}

function readPortalHost(): HTMLElement {
  return document.body;
}
