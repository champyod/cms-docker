'use client';

import { useCallback, useSyncExternalStore } from 'react';
import {
  applyDisplay,
  getAppliedDisplay,
  persistDisplay,
  resolveDisplay,
  subscribeToDisplay,
  type DisplayPreferences,
} from '@/lib/display-density';

export interface UseDisplayDensityResult {
  display: DisplayPreferences | null;
  setDisplay: (preferences: DisplayPreferences) => void;
}

const SERVER_SNAPSHOT = (): DisplayPreferences | null => null;

export function useDisplayDensity(): UseDisplayDensityResult {
  const display = useSyncExternalStore(subscribeToDisplay, getAppliedDisplay, SERVER_SNAPSHOT);

  const setDisplay = useCallback((preferences: DisplayPreferences) => {
    const resolved = resolveDisplay(preferences);
    applyDisplay(resolved);
    persistDisplay(resolved);
  }, []);

  return { display, setDisplay };
}
