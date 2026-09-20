'use client';

import { updateWorkers } from '@/app/actions/workerConfig';
import { toast } from 'sonner';
import { useActionFeedback } from '@/hooks/useActionFeedback';
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

  const runAction = useActionFeedback();

  const saveWorkers = async (): Promise<void> => {
    await runAction(
      {
        pending: 'Saving worker nodes...',
        success: 'Configuration Saved',
        failure: 'Failed to Save',
        description: 'Worker nodes updated in cms.toml. Restart services in Container Control Center to apply.',
      },
      () => updateWorkers(collection.workers),
    );
  };

  return { retryConnection, saveWorkers };
}
