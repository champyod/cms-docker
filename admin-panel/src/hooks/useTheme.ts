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

export function useTheme(): UseThemeResult {
  const theme = useSyncExternalStore(subscribeToTheme, getAppliedTheme, SERVER_SNAPSHOT);

  const toggleTheme = useCallback(() => {
    const current = getAppliedTheme() ?? resolveTheme(readStoredTheme(), getSystemPrefersDark());
    const next: ThemePreference = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    persistTheme(next);
  }, []);

  return { theme, toggleTheme };
}
