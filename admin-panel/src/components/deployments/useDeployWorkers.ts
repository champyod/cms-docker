'use client';

import { useState, useEffect, useCallback } from 'react';

import { getWorkers, updateWorkers } from '@/app/actions/workerConfig';
import { getWorkersLiveStatus, WorkerLiveDetail } from '@/app/actions/workers';
import { WorkerConfig } from '@/components/deployments/WorkersPanel';
import { useToast } from '@/components/providers/ToastProvider';

type SetSaving = React.Dispatch<React.SetStateAction<boolean>>;

export function useDeployWorkers(setSaving: SetSaving) {
    const { addToast } = useToast();
    const [workers, setWorkers] = useState<WorkerConfig[]>([]);
    const [originalWorkers, setOriginalWorkers] = useState<string>('[]');
    const [liveWorkers, setLiveWorkers] = useState<WorkerLiveDetail[]>([]);
    const [workersForbidden, setWorkersForbidden] = useState(false);
    const [canManageWorkers, setCanManageWorkers] = useState(true);

    const workersDirty = JSON.stringify(workers) !== originalWorkers;

    const loadWorkers = useCallback(async () => {
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
    }, []);

    useEffect(() => { loadWorkers(); }, [loadWorkers]);

    // Poll worker telemetry so activity/lagging stay fresh.
    useEffect(() => {
        const id = setInterval(async () => {
            try {
                const res = await getWorkersLiveStatus();
                if (!res.forbidden) setLiveWorkers(res.workers ?? []);
            } catch { /* keep last snapshot */ }
        }, 20_000);
        return () => clearInterval(id);
    }, []);

    const handleSaveWorkers = useCallback(async () => {
        setSaving(true);
        try {
            const result = await updateWorkers(workers);
            if (!result.success) {
                addToast({ type: 'error', title: 'Worker Sync Failed', message: result.error || 'Could not sync worker config' });
                setSaving(false);
                return;
            }
            setOriginalWorkers(JSON.stringify(workers));
            addToast({ type: 'success', title: 'Workers Synced', message: 'Worker configuration updated.' });
        } catch (error) {
            addToast({ type: 'error', title: 'Unexpected Error', message: (error as Error).message });
        } finally {
            setSaving(false);
        }
    }, [workers, addToast, setSaving]);

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
        workersForbidden,
        canManageWorkers,
        handleSaveWorkers,
        addGlobalWorker,
        removeGlobalWorker,
        updateGlobalWorker,
    };
}
