'use client';

import { useCallback, useState } from 'react';
import { apiClient } from '@/lib/apiClient';
import { useActionFeedback } from '@/hooks/useActionFeedback';
import { useConfirm } from '@/hooks/useConfirm';
import { useTaskConfirmationCopy, useTaskTabRefresh } from './useTaskTabRefresh';

export type TaskFileActions = {
  isUploadOpen: boolean;
  openUpload: () => void;
  closeUpload: () => void;
  deleteAttachment: (attachmentId: number) => Promise<void>;
};

export type TaskFilesTabState = TaskFileActions & {
  refresh: () => void;
};

export function useTaskFileActions(): TaskFilesTabState {
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const confirm = useConfirm();
  const { destructiveConfirm } = useTaskConfirmationCopy();
  const runAction = useActionFeedback();
  const refresh = useTaskTabRefresh();

  const openUpload = useCallback((): void => setIsUploadOpen(true), []);
  const closeUpload = useCallback((): void => setIsUploadOpen(false), []);

  const deleteAttachment = useCallback(async (attachmentId: number): Promise<void> => {
    if (!(await confirm(destructiveConfirm('attachment')))) return;
    const result = await runAction(
      { pending: 'Deleting attachment...', success: 'Attachment deleted', failure: 'Delete failed' },
      () => apiClient.delete(`/api/attachments/${attachmentId}`),
    );
    if (result?.success) refresh();
  }, [confirm, destructiveConfirm, runAction, refresh]);

  return { isUploadOpen, openUpload, closeUpload, deleteAttachment, refresh };
}
