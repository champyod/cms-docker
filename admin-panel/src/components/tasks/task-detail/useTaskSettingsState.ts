'use client';

import { useState } from 'react';
import { useTaskTabRefresh } from './useTaskTabRefresh';

export type TaskSettingsState = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
};

export type TaskSettingsTabState = TaskSettingsState & {
  refresh: () => void;
};

export function useTaskSettingsState(): TaskSettingsTabState {
  const [isOpen, setIsOpen] = useState(false);
  const refresh = useTaskTabRefresh();

  const open = (): void => setIsOpen(true);
  const close = (): void => setIsOpen(false);

  return { isOpen, open, close, refresh };
}
