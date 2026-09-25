'use client';

import { useState } from 'react';
import { useTaskTabRefresh } from './useTaskTabRefresh';

export function useTaskSettingsState(): {
  isSettingsModalOpen: boolean;
  setIsSettingsModalOpen: (open: boolean) => void;
  refresh: () => void;
} {
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const refresh = useTaskTabRefresh();
  return { isSettingsModalOpen, setIsSettingsModalOpen, refresh };
}
