'use client';

import { useState } from 'react';
import { useTaskTabRefresh } from './useTaskTabRefresh';

export function useTaskOverviewState(): {
  infoExpanded: boolean;
  statementsExpanded: boolean;
  toggleSection: (section: 'info' | 'statements') => void;
  isStatementModalOpen: boolean;
  setIsStatementModalOpen: (open: boolean) => void;
  refresh: () => void;
} {
  const [expanded, setExpanded] = useState({ info: true, statements: true });
  const [isStatementModalOpen, setIsStatementModalOpen] = useState(false);
  const refresh = useTaskTabRefresh();

  const toggleSection = (section: 'info' | 'statements'): void => {
    setExpanded((previous) => ({ ...previous, [section]: !previous[section] }));
  };

  return { infoExpanded: expanded.info, statementsExpanded: expanded.statements, toggleSection, isStatementModalOpen, setIsStatementModalOpen, refresh };
}
