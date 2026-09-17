'use client';

import { updateWorkers } from '@/app/actions/workerConfig';
import { toast } from 'sonner';
import type { WorkerNodesCollection } from './useWorkerNodesCollection';

export interface WorkerNodeActions {
  retryConnection: (host: string) => void;
  saveWorkers: () => Promise<void>;
}

export function useWorkerNodeActions(collection: WorkerNodesCollection): WorkerNodeActions {
  const retryConnection = (host: string): void => {
    toast.info('Reconnecting...', { description: `Attempting to reconnect ${host}` });
    setTimeout(() => { void collection.loadWorkers(); }, 1000);
  };

  const saveWorkers = async (): Promise<void> => {
    const res = await updateWorkers(collection.workers);
    if (res.success) {
      toast.success('Configuration Saved', {
        description: 'Worker nodes updated in cms.toml. You need to restart services in Container Control Center to apply the changes.',
      });
    } else {
      toast.error('Failed to Save', { description: res.error });
    }
  };

  return { retryConnection, saveWorkers };
}
