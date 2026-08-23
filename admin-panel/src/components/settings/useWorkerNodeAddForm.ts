'use client';

import { useState } from 'react';
import { WorkerEndpoint } from './workerNodesTypes';

export interface WorkerNodeAddFormState {
  newHost: string;
  newPort: string;
  showAddForm: boolean;
  setNewHost: (value: string) => void;
  setNewPort: (value: string) => void;
  setShowAddForm: (open: boolean) => void;
  toggleForm: () => void;
  handleAdd: () => void;
}

export function useWorkerNodeAddForm(
  workers: WorkerEndpoint[],
  replaceWorkers: (next: WorkerEndpoint[]) => void,
): WorkerNodeAddFormState {
  const [newHost, setNewHost] = useState('');
  const [newPort, setNewPort] = useState('26000');
  const [showAddForm, setShowAddForm] = useState(false);

  const handleAdd = (): void => {
    if (!newHost || !newPort) return;
    replaceWorkers([...workers, { host: newHost, port: parseInt(newPort) }]);
    setNewHost('');
    setNewPort('26000');
    setShowAddForm(false);
  };

  const toggleForm = (): void => setShowAddForm(open => !open);

  return {
    newHost,
    newPort,
    showAddForm,
    setNewHost,
    setNewPort,
    setShowAddForm,
    toggleForm,
    handleAdd,
  };
}
