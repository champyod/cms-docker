'use client';

import { useState } from 'react';
import { WorkerEditDraft, WorkerEndpoint } from './workerNodesTypes';

export interface WorkerNodeRowEditor {
  editingIndex: number | null;
  editData: WorkerEditDraft;
  setEditData: (draft: WorkerEditDraft) => void;
  startEdit: (index: number) => void;
  saveEdit: () => void;
  removeWorker: (index: number) => void;
}

export function useWorkerNodeRowEditor(
  workers: WorkerEndpoint[],
  replaceWorkers: (next: WorkerEndpoint[]) => void,
): WorkerNodeRowEditor {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editData, setEditData] = useState<WorkerEditDraft>({ host: '', port: '' });

  const startEdit = (index: number): void => {
    setEditingIndex(index);
    setEditData({ host: workers[index].host, port: workers[index].port.toString() });
  };

  const saveEdit = (): void => {
    if (editingIndex === null) return;
    const next = [...workers];
    next[editingIndex] = { host: editData.host, port: parseInt(editData.port) };
    replaceWorkers(next);
    setEditingIndex(null);
  };

  const removeWorker = (index: number): void => {
    const next = [...workers];
    next.splice(index, 1);
    replaceWorkers(next);
  };

  return { editingIndex, editData, setEditData, startEdit, saveEdit, removeWorker };
}
