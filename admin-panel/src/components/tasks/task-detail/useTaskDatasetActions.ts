'use client';

import { useState } from 'react';
import { apiClient } from '@/lib/apiClient';
import { useActionFeedback } from '@/hooks/useActionFeedback';
import { useConfirm, type Confirm } from '@/hooks/useConfirm';
import type { ConfirmationCopy } from '@/lib/confirmation-copy';
import type { TaskDatasetSummary } from '@/lib/queries/task-detail';
import { useTaskConfirmationCopy, useTaskTabRefresh } from './useTaskTabRefresh';

export type TaskDatasetActions = {
  isDatasetModalOpen: boolean;
  editingDataset: TaskDatasetSummary | null;
  openCreate: () => void;
  openEdit: (dataset: TaskDatasetSummary) => void;
  closeDataset: () => void;
  activate: (datasetId: number) => Promise<void>;
  clone: (datasetId: number, description: string) => Promise<void>;
  rename: (datasetId: number, description: string) => Promise<void>;
  toggleAutojudge: (datasetId: number) => Promise<void>;
  removeDataset: (datasetId: number) => Promise<void>;
  openTestcaseUpload: (datasetId: number) => void;
  removeTestcase: (testcaseId: number) => Promise<void>;
  togglePublic: (testcaseId: number) => Promise<void>;
};

export type TaskDatasetTabState = TaskDatasetActions & {
  expanded: boolean;
  toggleExpanded: () => void;
  uploadTargetDatasetId: number | null;
  closeTestcaseUpload: () => void;
};

type DatasetActionDeps = {
  runAction: ReturnType<typeof useActionFeedback>;
  confirm: Confirm;
  destructiveConfirm: ConfirmationCopy['destructiveConfirm'];
  refresh: () => void;
};

// Why: create and edit share one open flag — clearing the draft on create
// keeps a stale edit from leaking into the next fresh dataset dialog.
function useDatasetModalState(): Pick<TaskDatasetActions, 'isDatasetModalOpen' | 'editingDataset' | 'openCreate' | 'openEdit' | 'closeDataset'> {
  const [isDatasetModalOpen, setIsDatasetModalOpen] = useState(false);
  const [editingDataset, setEditingDataset] = useState<TaskDatasetSummary | null>(null);

  const openCreate = (): void => {
    setEditingDataset(null);
    setIsDatasetModalOpen(true);
  };

  const openEdit = (dataset: TaskDatasetSummary): void => {
    setEditingDataset(dataset);
    setIsDatasetModalOpen(true);
  };

  const closeDataset = (): void => setIsDatasetModalOpen(false);

  return { isDatasetModalOpen, editingDataset, openCreate, openEdit, closeDataset };
}

function buildDatasetLifecycleActions(deps: DatasetActionDeps): Pick<TaskDatasetActions, 'activate' | 'toggleAutojudge' | 'removeDataset'> {
  const activate = async (datasetId: number): Promise<void> => {
    const result = await deps.runAction(
      { pending: 'Activating dataset...', success: 'Dataset activated', failure: 'Activation failed', description: 'It is now the live dataset.' },
      () => apiClient.put(`/api/datasets/${datasetId}`, { action: 'activate' }),
    );
    if (result?.success) deps.refresh();
  };

  const toggleAutojudge = async (datasetId: number): Promise<void> => {
    const result = await deps.runAction(
      { pending: 'Toggling autojudge...', success: 'Autojudge toggled', failure: 'Toggle failed' },
      () => apiClient.put(`/api/datasets/${datasetId}`, { action: 'toggle-autojudge' }),
    );
    if (result?.success) deps.refresh();
  };

  const removeDataset = async (datasetId: number): Promise<void> => {
    if (!(await deps.confirm(deps.destructiveConfirm('dataset')))) return;
    const result = await deps.runAction(
      { pending: 'Deleting dataset...', success: 'Dataset deleted', failure: 'Delete failed' },
      () => apiClient.delete(`/api/datasets/${datasetId}`),
    );
    if (result?.success) deps.refresh();
  };

  return { activate, toggleAutojudge, removeDataset };
}

// Why: clone/rename keep the legacy browser prompt unchanged — the final
// deduplication plan owns replacing both call sites with a shared dialog.
function buildDatasetCopyActions(deps: DatasetActionDeps): Pick<TaskDatasetActions, 'clone' | 'rename'> {
  const clone = async (datasetId: number, description: string): Promise<void> => {
    const clonedName = window.prompt('Enter name for cloned dataset:', `${description} (copy)`);
    if (!clonedName) return;
    const result = await deps.runAction(
      {
        pending: 'Cloning dataset...',
        success: 'Dataset cloned',
        failure: 'Clone failed',
        description: `"${clonedName}" created successfully.`,
      },
      () => apiClient.post(`/api/datasets/${datasetId}/clone`, { newDescription: clonedName }),
    );
    if (result?.success) deps.refresh();
  };

  const rename = async (datasetId: number, description: string): Promise<void> => {
    const renamedName = window.prompt('Enter new name:', description);
    if (!renamedName || renamedName === description) return;
    const result = await deps.runAction(
      {
        pending: 'Renaming dataset...',
        success: 'Dataset renamed',
        failure: 'Rename failed',
        description: `Renamed to "${renamedName}".`,
      },
      () => apiClient.put(`/api/datasets/${datasetId}`, { action: 'rename', description: renamedName }),
    );
    if (result?.success) deps.refresh();
  };

  return { clone, rename };
}

function buildTestcaseActions(deps: DatasetActionDeps): Pick<TaskDatasetActions, 'removeTestcase' | 'togglePublic'> {
  const removeTestcase = async (testcaseId: number): Promise<void> => {
    if (!(await deps.confirm(deps.destructiveConfirm('testcase')))) return;
    const result = await deps.runAction(
      { pending: 'Deleting testcase...', success: 'Testcase deleted', failure: 'Delete failed' },
      () => apiClient.delete(`/api/testcases/${testcaseId}`),
    );
    if (result?.success) deps.refresh();
  };

  const togglePublic = async (testcaseId: number): Promise<void> => {
    const result = await deps.runAction(
      { pending: 'Updating visibility...', success: 'Visibility updated', failure: 'Update failed' },
      () => apiClient.put(`/api/testcases/${testcaseId}`, { action: 'toggle-public' }),
    );
    if (result?.success) deps.refresh();
  };

  return { removeTestcase, togglePublic };
}

export function useTaskDatasetActions(): TaskDatasetTabState {
  const [expanded, setExpanded] = useState(true);
  const [uploadTargetDatasetId, setUploadTargetDatasetId] = useState<number | null>(null);
  const modal = useDatasetModalState();
  const confirm = useConfirm();
  const { destructiveConfirm } = useTaskConfirmationCopy();
  const runAction = useActionFeedback();
  const refresh = useTaskTabRefresh();
  const deps: DatasetActionDeps = { runAction, confirm, destructiveConfirm, refresh };

  const toggleExpanded = (): void => setExpanded((previous) => !previous);
  const openTestcaseUpload = (datasetId: number): void => setUploadTargetDatasetId(datasetId);
  const closeTestcaseUpload = (): void => setUploadTargetDatasetId(null);

  return {
    ...modal,
    ...buildDatasetLifecycleActions(deps),
    ...buildDatasetCopyActions(deps),
    ...buildTestcaseActions(deps),
    expanded,
    toggleExpanded,
    openTestcaseUpload,
    uploadTargetDatasetId,
    closeTestcaseUpload,
  };
}
