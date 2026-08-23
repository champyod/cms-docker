'use client';

import { updateWorkers } from '@/app/actions/workerConfig';
import { useToast } from '@/components/providers/ToastProvider';
import type { WorkerNodesCollection } from './useWorkerNodesCollection';

export interface WorkerNodeActions {
  retryConnection: (host: string) => void;
  saveWorkers: () => Promise<void>;
}

export function useWorkerNodeActions(collection: WorkerNodesCollection): WorkerNodeActions {
  const { addToast } = useToast();

  const retryConnection = (host: string): void => {
    addToast({ title: 'Reconnecting...', message: `Attempting to reconnect ${host}`, type: 'info' });
    setTimeout(() => { void collection.loadWorkers(); }, 1000);
  };

  const saveWorkers = async (): Promise<void> => {
    const res = await updateWorkers(collection.workers);
    if (res.success) {
      addToast({
        title: 'Configuration Saved',
        message: 'Worker nodes updated in cms.toml. You need to restart services in Container Control Center to apply the changes.',
        type: 'success'
      });
    } else {
      addToast({ title: 'Failed to Save', message: res.error, type: 'error' });
    }
  };

  return { retryConnection, saveWorkers };
}
