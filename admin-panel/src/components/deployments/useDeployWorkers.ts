'use client';

import { useState, useEffect, useCallback } from 'react';

import { getWorkers, updateWorkers } from '@/app/actions/workerConfig';
import { getWorkersLiveStatus } from '@/app/actions/workers';
import { useLiveStream } from '@/hooks/useLiveStream';
import { useLiveReadInstants } from '@/lib/live/use-live-reads';
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
    const [workersError, setWorkersError] = useState<string | null>(null);

    const workersDirty = JSON.stringify(workers) !== originalWorkers;

    useEffect(() => {
        void (async () => {
            const [workersRead, statusResult] = await Promise.all([getWorkers(), getWorkersLiveStatus()]);
            setWorkers(workersRead.workers);
            setOriginalWorkers(JSON.stringify(workersRead.workers));

            if (statusResult && !statusResult.forbidden) {
                setLiveWorkers(statusResult.workers);
                setCanManageWorkers(statusResult.canManage);
                setWorkersForbidden(false);
                setWorkersError(workersRead.error ?? statusResult.error ?? null);
            } else {
                setWorkersForbidden(true);
                setWorkersError(workersRead.error);
            }
        })();
    }, []);

    // Why the readings travel whole on the frame and not as a cursor: they are the data this panel
    // shows, so the panel keeps its last reading until the next one arrives. The read that produced
    // the fleet is recorded with it, so a row can be told apart from one the server has since re-read.
    const reads = useLiveReadInstants<'workers'>();
    const onWorkersFrame = useCallback((frame: WorkersFrame, readAt: string): void => {
        setLiveWorkers(frame.workers);
        reads.record('workers', readAt);
        if (frame.error !== undefined) setWorkersError(frame.error);
    }, [reads]);

    // Why the stream's own state travels to the rows instead of to a badge: the panel's status blob was
    // removed on purpose, and a row the panel can no longer confirm is where that has to be visible.
    const { status: streamStatus, readAt: surfaceReadAt } = useLiveStream<WorkersFrame>({
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
        // The cue's input, ready-made from the read that produced the list and the stream's own state.
        freshness: { readAt: reads.reads.workers ?? null, surfaceReadAt, streamStatus },
        workersForbidden,
        workersError,
        canManageWorkers,
        handleSaveWorkers,
        addGlobalWorker,
        removeGlobalWorker,
        updateGlobalWorker,
    };
}
