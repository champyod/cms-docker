'use client';

import { useCallback, useSyncExternalStore } from 'react';
import {
  applyHighContrast,
  getAppliedHighContrast,
  persistHighContrast,
  subscribeToHighContrast,
  type ContrastPreference,
} from '@/lib/high-contrast';

export interface UseHighContrastResult {
  highContrast: boolean | null;
  setHighContrast: (preference: ContrastPreference) => void;
}

const SERVER_SNAPSHOT = (): boolean | null => null;

export function useHighContrast(): UseHighContrastResult {
  const highContrast = useSyncExternalStore(
    subscribeToHighContrast,
    getAppliedHighContrast,
    SERVER_SNAPSHOT
  );

  const setHighContrast = useCallback((preference: ContrastPreference) => {
    applyHighContrast(preference);
    persistHighContrast(preference);
  }, []);

  return { highContrast, setHighContrast };
}
