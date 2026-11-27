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

// Mount flag as an external store (server false, client true) so the theme
// value stays on the server snapshot during hydration and resolves after mount.
function subscribeMount(): () => void {
  return () => undefined;
}

const MOUNTED_CLIENT_SNAPSHOT = (): boolean => true;
const MOUNTED_SERVER_SNAPSHOT = (): boolean => false;

export function useTheme(): UseThemeResult {
  const storeTheme = useSyncExternalStore(subscribeToTheme, getAppliedTheme, SERVER_SNAPSHOT);
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
