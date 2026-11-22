'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  applyTheme,
  getSystemPrefersDark,
  getThemePreference,
  nextThemePreference,
  persistTheme,
  resolveTheme,
  subscribeToTheme,
  type ResolvedTheme,
  type ThemePreference,
} from '@/lib/theme';

export interface UseThemeResult {
  /** What the person chose, or null before the client has resolved it. */
  preference: ThemePreference | null;
  /** What is painted right now — `system` already resolved. */
  resolved: ResolvedTheme | null;
  /** Choose one of the three states explicitly. */
  setPreference: (next: ThemePreference) => void;
  /** Advance system -> light -> dark -> system, for a single control. */
  cyclePreference: () => void;
}

const SERVER_SNAPSHOT = (): ThemePreference | null => null;

// Mount flag as an external store (server false, client true) so the theme
// value stays on the server snapshot during hydration and resolves after mount.
function subscribeMount(): () => void {
  return () => undefined;
}

const MOUNTED_CLIENT_SNAPSHOT = (): boolean => true;
const MOUNTED_SERVER_SNAPSHOT = (): boolean => false;

function subscribeToMedia(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined;
  }
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

export function useTheme(): UseThemeResult {
  const storePreference = useSyncExternalStore(subscribeToTheme, getThemePreference, SERVER_SNAPSHOT);
  const mounted = useSyncExternalStore(subscribeMount, MOUNTED_CLIENT_SNAPSHOT, MOUNTED_SERVER_SNAPSHOT);

  // A person on `system` expects the page to follow the OS while it is open, not only at load.
  useEffect(() => {
    if (!mounted || storePreference !== 'system') return undefined;
    const follow = (): void => {
      applyTheme('system');
    };
    return subscribeToMedia(follow);
  }, [mounted, storePreference]);

  const preference = mounted ? storePreference : null;
  const resolved = preference === null ? null : resolveTheme(preference, getSystemPrefersDark());

  const setPreference = useCallback((next: ThemePreference) => {
    applyTheme(next);
    persistTheme(next);
  }, []);

  const cyclePreference = useCallback(() => {
    const current = getThemePreference();
    const next = nextThemePreference(current);
    applyTheme(next);
    persistTheme(next);
  }, []);

  return { preference, resolved, setPreference, cyclePreference };
}
