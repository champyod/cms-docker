'use client';

import { useCallback, useSyncExternalStore } from 'react';
import {
  applyTheme,
  getAppliedTheme,
  getSystemPrefersDark,
  persistTheme,
  readStoredTheme,
  resolveTheme,
  subscribeToTheme,
  type ThemePreference,
} from '@/lib/theme';

export interface UseThemeResult {
  theme: ThemePreference | null;
  toggleTheme: () => void;
}

const SERVER_SNAPSHOT = (): ThemePreference | null => null;

// Why module-scope mount store: useState+useEffect mount flags violate the
// set-state-in-effect lint rule. A mount-only external store (never notifies,
// server false / client true) keeps hydration on the server snapshot, then
// flips post-hydration without an effect.
function subscribeMount(): () => void {
  return () => undefined;
}

const MOUNTED_CLIENT_SNAPSHOT = (): boolean => true;
const MOUNTED_SERVER_SNAPSHOT = (): boolean => false;

export function useTheme(): UseThemeResult {
  const storeTheme = useSyncExternalStore(subscribeToTheme, getAppliedTheme, SERVER_SNAPSHOT);
  // Why mounted gates the store value: the server snapshot is null and the
  // no-flash script may already have set .dark before hydration, so reading
  // the store during hydration renders Sun against server Moon (React #418).
  // Holding null until after mount keeps hydration identical, then resolves.
  const mounted = useSyncExternalStore(subscribeMount, MOUNTED_CLIENT_SNAPSHOT, MOUNTED_SERVER_SNAPSHOT);
  const theme = mounted ? storeTheme : null;

  const toggleTheme = useCallback(() => {
    const current = getAppliedTheme() ?? resolveTheme(readStoredTheme(), getSystemPrefersDark());
    const next: ThemePreference = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    persistTheme(next);
  }, []);

  return { theme, toggleTheme };
}
