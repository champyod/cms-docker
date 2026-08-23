'use client';

import { useEffect, useState } from 'react';
import { getWorkers } from '@/app/actions/workerConfig';
import { getWorkerStatus } from '@/app/actions/workers';
import { WorkerEndpoint, WorkerStatus } from './workerNodesTypes';

async function fetchWorkerStatuses(workers: WorkerEndpoint[]): Promise<WorkerStatus[]> {
  return Promise.all(
    workers.map(async (w) => {
      try {
        const res = await getWorkerStatus(w.host, w.port);
        return {
          host: w.host,
          port: w.port,
          status: (res.status || 'unknown') as WorkerStatus['status'],
          containerRunning: res.containerRunning || false
        };
      } catch {
        return {
          host: w.host,
          port: w.port,
          status: 'unknown' as const,
          containerRunning: false
        };
      }
    })
  );
}

export interface WorkerNodesCollection {
  workers: WorkerEndpoint[];
  replaceWorkers: (next: WorkerEndpoint[]) => void;
  workerStatus: WorkerStatus[];
  loading: boolean;
  loadWorkers: () => Promise<void>;
}

export function useWorkerNodesCollection(): WorkerNodesCollection {
  const [workers, setWorkers] = useState<WorkerEndpoint[]>([]);
  const [workerStatus, setWorkerStatus] = useState<WorkerStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const loadWorkers = async (): Promise<void> => {
    setLoading(true);
    const data = await getWorkers();
    setWorkers(data);
    const statuses = await fetchWorkerStatuses(data);
    setWorkerStatus(statuses);
    setLoading(false);
  };

  useEffect(() => {
    void loadWorkers();
  }, []);

  const replaceWorkers = (next: WorkerEndpoint[]): void => setWorkers(next);

  return { workers, replaceWorkers, workerStatus, loading, loadWorkers };
}
