'use client';

import { useState } from 'react';
import { apiClient } from '@/lib/apiClient';
import { useActionFeedback } from '@/hooks/useActionFeedback';
import { useConfirm } from '@/hooks/useConfirm';
import type { TaskDatasetSummary } from '@/lib/queries/task-detail';
import { useTaskConfirmationCopy, useTaskTabRefresh } from './useTaskTabRefresh';

export function useTaskDatasetActions(): {
  expanded: boolean;
  toggleExpanded: () => void;
  isDatasetModalOpen: boolean;
  editingDataset: TaskDatasetSummary | null;
  startCreateDataset: () => void;
  startEditDataset: (dataset: TaskDatasetSummary) => void;
  closeDatasetModal: () => void;
  uploadTargetDatasetId: number | null;
  setUploadTargetDatasetId: (datasetId: number | null) => void;
  handleActivateDataset: (datasetId: number) => Promise<void>;
  handleCloneDataset: (datasetId: number, description: string) => Promise<void>;
  handleRenameDataset: (datasetId: number, currentDescription: string) => Promise<void>;
  handleDeleteDataset: (datasetId: number) => Promise<void>;
  handleToggleAutojudge: (datasetId: number) => Promise<void>;
  handleDeleteTestcase: (testcaseId: number) => Promise<void>;
  handleTogglePublic: (testcaseId: number) => Promise<void>;
} {
  const [expanded, setExpanded] = useState(true);
  const [isDatasetModalOpen, setIsDatasetModalOpen] = useState(false);
  const [editingDataset, setEditingDataset] = useState<TaskDatasetSummary | null>(null);
  const [uploadTargetDatasetId, setUploadTargetDatasetId] = useState<number | null>(null);
  const confirm = useConfirm();
  const { destructiveConfirm } = useTaskConfirmationCopy();
  const runAction = useActionFeedback();
  const refresh = useTaskTabRefresh();

  const toggleExpanded = (): void => setExpanded((previous) => !previous);

  const startCreateDataset = (): void => {
    setEditingDataset(null);
    setIsDatasetModalOpen(true);
  };

  const startEditDataset = (dataset: TaskDatasetSummary): void => {
    setEditingDataset(dataset);
    setIsDatasetModalOpen(true);
  };

  const closeDatasetModal = (): void => setIsDatasetModalOpen(false);

  const handleActivateDataset = async (datasetId: number): Promise<void> => {
    const result = await runAction(
      { pending: 'Activating dataset...', success: 'Dataset activated', failure: 'Activation failed', description: 'It is now the live dataset.' },
      () => apiClient.put(`/api/datasets/${datasetId}`, { action: 'activate' }),
    );
    if (result?.success) refresh();
  };

  const handleCloneDataset = async (datasetId: number, description: string): Promise<void> => {
    const newName = prompt('Enter name for cloned dataset:', `${description} (copy)`);
    if (!newName) return;
    const result = await runAction(
      {
        pending: 'Cloning dataset...',
        success: 'Dataset cloned',
        failure: 'Clone failed',
        description: `"${newName}" created successfully.`,
      },
      () => apiClient.post(`/api/datasets/${datasetId}/clone`, { newDescription: newName }),
    );
    if (result?.success) refresh();
  };

  const handleRenameDataset = async (datasetId: number, currentDescription: string): Promise<void> => {
    const newName = prompt('Enter new name:', currentDescription);
    if (!newName || newName === currentDescription) return;
    const result = await runAction(
      {
        pending: 'Renaming dataset...',
        success: 'Dataset renamed',
        failure: 'Rename failed',
        description: `Renamed to "${newName}".`,
      },
      () => apiClient.put(`/api/datasets/${datasetId}`, { action: 'rename', description: newName }),
    );
    if (result?.success) refresh();
  };

  const handleDeleteDataset = async (datasetId: number): Promise<void> => {
    if (!(await confirm(destructiveConfirm('dataset')))) return;
    const result = await runAction(
      { pending: 'Deleting dataset...', success: 'Dataset deleted', failure: 'Delete failed' },
      () => apiClient.delete(`/api/datasets/${datasetId}`),
    );
    if (result?.success) refresh();
  };

  const handleToggleAutojudge = async (datasetId: number): Promise<void> => {
    const result = await runAction(
      { pending: 'Toggling autojudge...', success: 'Autojudge toggled', failure: 'Toggle failed' },
      () => apiClient.put(`/api/datasets/${datasetId}`, { action: 'toggle-autojudge' }),
    );
    if (result?.success) refresh();
  };

  const handleDeleteTestcase = async (testcaseId: number): Promise<void> => {
    if (!(await confirm(destructiveConfirm('testcase')))) return;
    const result = await runAction(
      { pending: 'Deleting testcase...', success: 'Testcase deleted', failure: 'Delete failed' },
      () => apiClient.delete(`/api/testcases/${testcaseId}`),
    );
    if (result?.success) refresh();
  };

  const handleTogglePublic = async (testcaseId: number): Promise<void> => {
    const result = await runAction(
      { pending: 'Updating visibility...', success: 'Visibility updated', failure: 'Update failed' },
      () => apiClient.put(`/api/testcases/${testcaseId}`, { action: 'toggle-public' }),
    );
    if (result?.success) refresh();
  };

  return {
    expanded, toggleExpanded, isDatasetModalOpen, editingDataset,
    startCreateDataset, startEditDataset, closeDatasetModal,
    uploadTargetDatasetId, setUploadTargetDatasetId,
    handleActivateDataset, handleCloneDataset, handleRenameDataset,
    handleDeleteDataset, handleToggleAutojudge, handleDeleteTestcase, handleTogglePublic,
  };
}
