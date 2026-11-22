'use client';

import { useCallback, useSyncExternalStore } from 'react';
import {
  applyContrast,
  getContrastPreference,
  persistContrast,
  subscribeToContrast,
  type ContrastPreference,
} from '@/lib/theme';

export interface UseContrastResult {
  /** What the person chose, or null before the client has resolved it. */
  preference: ContrastPreference | null;
  setPreference: (next: ContrastPreference) => void;
  toggle: () => void;
}

const SERVER_SNAPSHOT = (): ContrastPreference | null => null;

export function useContrast(): UseContrastResult {
  const store = useSyncExternalStore(subscribeToContrast, getContrastPreference, SERVER_SNAPSHOT);

  const setPreference = useCallback((next: ContrastPreference): void => {
    applyContrast(next);
    persistContrast(next);
  }, []);

  const toggle = useCallback((): void => {
    setPreference(store === 'high' ? 'normal' : 'high');
  }, [setPreference, store]);

  return { preference: store, setPreference, toggle };
}
