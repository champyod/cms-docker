'use client';

import { useState, useEffect, useCallback } from 'react';

import { getWorkers, updateWorkers } from '@/app/actions/workerConfig';
import { getWorkersLiveStatus } from '@/app/actions/workers';
import { useLiveStream } from '@/hooks/useLiveStream';
import type { WorkersFrame } from '@/lib/live/frames';
import type { WorkerConfig, WorkerNodeView } from '@/lib/worker-nodes';
import { toast } from 'sonner';

type SetSaving = React.Dispatch<React.SetStateAction<boolean>>;

export function useDeployWorkers(setSaving: SetSaving) {
    const [workers, setWorkers] = useState<WorkerConfig[]>([]);
    const [originalWorkers, setOriginalWorkers] = useState<string>('[]');
    const [liveWorkers, setLiveWorkers] = useState<WorkerNodeView[]>([]);
    const [workersForbidden, setWorkersForbidden] = useState(false);
    const [canManageWorkers, setCanManageWorkers] = useState(true);

    const workersDirty = JSON.stringify(workers) !== originalWorkers;

    useEffect(() => {
        void (async () => {
            const [workersResult, statusResult] = await Promise.all([getWorkers(), getWorkersLiveStatus()]);
            const normalized = Array.isArray(workersResult) ? workersResult : [];
            setWorkers(normalized);
            setOriginalWorkers(JSON.stringify(normalized));

            if (statusResult && !statusResult.forbidden) {
                setLiveWorkers(statusResult.workers ?? []);
                setCanManageWorkers(statusResult.canManage);
                setWorkersForbidden(false);
            } else {
                setWorkersForbidden(true);
            }
        })();
    }, []);

    // Why the readings travel whole on the frame and not as a cursor: they are the data this panel
    // shows, so the panel keeps its last reading until the next one arrives.
    const onWorkersFrame = useCallback((frame: WorkersFrame): void => {
        setLiveWorkers(frame.workers);
    }, []);

    const { status: liveStatus } = useLiveStream<WorkersFrame>({
        url: '/api/workers/stream',
        onFrame: onWorkersFrame,
    });

    const handleSaveWorkers = useCallback(async () => {
        setSaving(true);
        try {
            const result = await updateWorkers(workers);
            if (!result.success) {
                toast.error('Worker Sync Failed', { description: result.error || 'Could not sync worker config' });
                setSaving(false);
                return;
            }
            setOriginalWorkers(JSON.stringify(workers));
            toast.success('Workers Synced', { description: 'Worker configuration updated.' });
        } catch (error) {
            toast.error('Unexpected Error', { description: (error as Error).message });
        } finally {
            setSaving(false);
        }
    }, [workers, setSaving]);

    const addGlobalWorker = useCallback(() => setWorkers((previous) => [...previous, { host: '', port: 26000 }]), []);
    const removeGlobalWorker = useCallback((index: number) => setWorkers((previous) => previous.filter((_, i) => i !== index)), []);
    const updateGlobalWorker = useCallback((index: number, field: 'host' | 'port', value: string) => {
        setWorkers((previous) => {
            const newWorkers = [...previous];
            if (field === 'port') {
                newWorkers[index].port = parseInt(value) || 26000;
            } else {
                newWorkers[index].host = value;
            }
            return newWorkers;
        });
    }, []);

    return {
        workers,
        workersDirty,
        liveWorkers,
        liveStatus,
        workersForbidden,
        canManageWorkers,
        handleSaveWorkers,
        addGlobalWorker,
        removeGlobalWorker,
        updateGlobalWorker,
    };
}
