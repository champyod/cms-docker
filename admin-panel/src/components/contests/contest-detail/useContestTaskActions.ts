'use client';

import { useState } from 'react';
import { useConfirm } from '@/hooks/useConfirm';
import { useActionFeedback } from '@/hooks/useActionFeedback';
import { removeTaskFromContest } from '@/app/actions/contests';
import { useTabConfirmationCopy, useTabRefresh } from './useContestSettingsState';

export function useContestTaskActions(): {
  isTaskModalOpen: boolean;
  setIsTaskModalOpen: (open: boolean) => void;
  handleRemoveTask: (taskId: number) => Promise<void>;
} {
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const confirm = useConfirm();
  const copy = useTabConfirmationCopy();
  const runAction = useActionFeedback();
  const refresh = useTabRefresh();

  const handleRemoveTask = async (taskId: number): Promise<void> => {
    if (!(await confirm(copy.removeTaskFromContestConfirm()))) return;
    const result = await runAction(
      { pending: 'Removing task...', success: 'Task removed', failure: 'Remove failed' },
      () => removeTaskFromContest(taskId),
    );
    if (result?.success) refresh();
  };

  return { isTaskModalOpen, setIsTaskModalOpen, handleRemoveTask };
}
