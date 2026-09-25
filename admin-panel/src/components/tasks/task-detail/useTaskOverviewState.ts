'use client';

import { useState } from 'react';
import { apiClient } from '@/lib/apiClient';
import { useActionFeedback } from '@/hooks/useActionFeedback';
import { useConfirm } from '@/hooks/useConfirm';
import { useTaskConfirmationCopy, useTaskTabRefresh } from './useTaskTabRefresh';

export type TaskStatementActions = {
  isUploadOpen: boolean;
  openUpload: () => void;
  closeUpload: () => void;
  deleteStatement: (statementId: number) => Promise<void>;
};

export type TaskOverviewTabState = TaskStatementActions & {
  infoExpanded: boolean;
  statementsExpanded: boolean;
  toggleSection: (section: 'info' | 'statements') => void;
  refresh: () => void;
};

export function useTaskOverviewState(): TaskOverviewTabState {
  const [expanded, setExpanded] = useState({ info: true, statements: true });
  const [isStatementModalOpen, setIsStatementModalOpen] = useState(false);
  const confirm = useConfirm();
  const { destructiveConfirm } = useTaskConfirmationCopy();
  const runAction = useActionFeedback();
  const refresh = useTaskTabRefresh();

  const toggleSection = (section: 'info' | 'statements'): void => {
    setExpanded((previous) => ({ ...previous, [section]: !previous[section] }));
  };

  const openUpload = (): void => setIsStatementModalOpen(true);
  const closeUpload = (): void => setIsStatementModalOpen(false);

  const deleteStatement = async (statementId: number): Promise<void> => {
    if (!(await confirm(destructiveConfirm('statement')))) return;
    const result = await runAction(
      { pending: 'Deleting statement...', success: 'Statement deleted', failure: 'Delete failed' },
      () => apiClient.delete(`/api/statements/${statementId}`),
    );
    if (result?.success) refresh();
  };

  return {
    infoExpanded: expanded.info,
    statementsExpanded: expanded.statements,
    toggleSection,
    isUploadOpen: isStatementModalOpen,
    openUpload,
    closeUpload,
    deleteStatement,
    refresh,
  };
}
