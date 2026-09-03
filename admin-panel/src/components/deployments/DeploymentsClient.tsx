'use client';

import { useState, useEffect } from 'react';
import { readEnvFile, updateEnvFile } from '@/app/actions/env';
import { getAvailableContests } from '@/app/actions/contests';
import { getWorkers, updateWorkers } from '@/app/actions/workerConfig';
import { getWorkersLiveStatus, WorkerLiveDetail } from '@/app/actions/workers';
import { useDeployContest } from '@/hooks/useDeployContest';
import { PageContent, PageHeader, Stack } from '@/components/core/Layout';
import { Loading } from '@/components/core/Loading';
import { useToast } from '@/components/providers/ToastProvider';
import { MismatchBanner } from '@/components/deployments/MismatchBanner';
import { ActiveContestCard, ContestOption } from '@/components/deployments/ActiveContestCard';
import { ContestSettingsForm } from '@/components/deployments/ContestSettingsForm';
import { WorkersPanel, WorkerConfig } from '@/components/deployments/WorkersPanel';

export function DeploymentsClient() {
    const { addToast } = useToast();
    const { state: deployState, deploy: handleDeploy, cancel: cancelDeploy, reset: resetDeploy } = useDeployContest();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [availableContests, setAvailableContests] = useState<ContestOption[]>([]);
    const [activeContestId, setActiveContestId] = useState<number | null>(null);
    const [activeContestName, setActiveContestName] = useState<string | null>(null);
    const [dbActiveContestId, setDbActiveContestId] = useState<number | null>(null);
    const [selectedContestId, setSelectedContestId] = useState<number | null>(null);
    const [globalSettings, setGlobalSettings] = useState<Record<string, string>>({});
    const [originalGlobal, setOriginalGlobal] = useState<string>('{}');
    const [workers, setWorkers] = useState<WorkerConfig[]>([]);
    const [originalWorkers, setOriginalWorkers] = useState<string>('[]');
    const [liveWorkers, setLiveWorkers] = useState<WorkerLiveDetail[]>([]);
    const [workersForbidden, setWorkersForbidden] = useState(false);
    const [canManageWorkers, setCanManageWorkers] = useState(true);

    const isDirty = JSON.stringify(globalSettings) !== originalGlobal;
    const workersDirty = JSON.stringify(workers) !== originalWorkers;
    const hasChangedContest = selectedContestId !== null && selectedContestId !== activeContestId;

    const applyEnvSnapshot = (envResult: Awaited<ReturnType<typeof readEnvFile>>) => {
        let actualActiveId: number | null = null;
        if (envResult.success && envResult.config) {
            const activeId = parseInt(envResult.config.ACTIVE_CONTEST_ID || envResult.config.CONTEST_ID || '0');
            actualActiveId = activeId > 0 ? activeId : null;
            setActiveContestId(actualActiveId);
            setSelectedContestId(actualActiveId);

            const globals = { ...envResult.config };
            delete globals.ACTIVE_CONTEST_ID;
            delete globals.CONTEST_ID;
            setGlobalSettings(globals);
            setOriginalGlobal(JSON.stringify(globals));
        }
        return actualActiveId;
    };

    const loadData = async () => {
        setLoading(true);
        const [envResult, contestsResult, workersResult, statusResult] = await Promise.all([
            readEnvFile('.env.contest'),
            getAvailableContests(),
            getWorkers(),
            getWorkersLiveStatus()
        ]);

        const actualActiveId = applyEnvSnapshot(envResult);

        const databaseContests = contestsResult.success ? contestsResult.contests : [];
        setAvailableContests(databaseContests);

        const dbActive = databaseContests.find((c: { id: number; name: string; is_active: boolean }) => c.is_active === true);
        const dbActiveId = dbActive ? dbActive.id : null;
        setDbActiveContestId(dbActiveId);

        // Read the freshly parsed id, not the state binding — setState in this same tick leaves the closure stale.
        const envActiveId = actualActiveId;
        if (envActiveId) {
            const match = databaseContests.find((c: { id: number; name: string; is_active: boolean }) => c.id === envActiveId);
            if (match) setActiveContestName(match.name);
        }

        const normalizedWorkers = Array.isArray(workersResult) ? workersResult : [];
        setWorkers(normalizedWorkers);
        setOriginalWorkers(JSON.stringify(normalizedWorkers));

        if (statusResult && !statusResult.forbidden) {
            setLiveWorkers(statusResult.workers ?? []);
            setCanManageWorkers(statusResult.canManage);
            setWorkersForbidden(false);
        } else {
            setWorkersForbidden(true);
        }

        setLoading(false);
    };

    useEffect(() => { loadData(); }, []);

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

    const handleActivateAndRestart = () => {
        if (!selectedContestId || !hasChangedContest) return;
        setSaving(true);
        handleDeploy(selectedContestId);
    };

    useEffect(() => {
        if (deployState.phase === 'completed') {
            setSaving(false);
            const cId = deployState.contestId;
            if (cId !== null) {
                setActiveContestId(cId);
                const match = availableContests.find(c => c.id === cId);
                if (match) setActiveContestName(match.name);
            }
            // Toast is handled inside useDeployContest via EventSource progress and completion
            resetDeploy();
        } else if (deployState.phase === 'failed' || deployState.phase === 'timeout') {
            setSaving(false);
            resetDeploy();
        } else if (deployState.phase === 'already_running') {
            setSaving(false);
            resetDeploy();
        } else if (deployState.phase === 'idle' && saving) {
            setSaving(false);
        }
    }, [deployState.phase]);

    const handleSaveSettings = async () => {
        setSaving(true);
        try {
            const result = await updateEnvFile('.env.contest', globalSettings);
            if (!result.success) {
                addToast({ type: 'error', title: 'Save Failed', message: result.error || 'Could not update env file' });
                setSaving(false);
                return;
            }
            setOriginalGlobal(JSON.stringify(globalSettings));
            addToast({ type: 'success', title: 'Settings Saved', message: 'Contest settings updated.' });
        } catch (error) {
            addToast({ type: 'error', title: 'Unexpected Error', message: (error as Error).message });
        } finally {
            setSaving(false);
        }
    };

    const handleSaveWorkers = async () => {
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
    };

    const handleGlobalChange = (key: string, val: string) => {
        setGlobalSettings(prev => ({ ...prev, [key]: val }));
    };

    const addGlobalWorker = () => setWorkers([...workers, { host: '', port: 26000 }]);
    const removeGlobalWorker = (index: number) => setWorkers(workers.filter((_, i) => i !== index));
    const updateGlobalWorker = (index: number, field: 'host' | 'port', value: string) => {
        const newWorkers = [...workers];
        if (field === 'port') {
            newWorkers[index].port = parseInt(value) || 26000;
        } else {
            newWorkers[index].host = value;
        }
        setWorkers(newWorkers);
    };

    const hasMismatch = !deployState.phase.startsWith('deploy') && !deployState.phase.startsWith('poll') && activeContestId !== null && dbActiveContestId !== null && activeContestId !== dbActiveContestId;

    if (loading) return <Loading text="Loading contest deployment..." fullScreen />;

    return (
        <PageContent className="pb-20">
            <PageHeader
                title="Active Contest Deployment"
                description="Select, activate, and manage the currently deployed contest stack."
            />

            {hasMismatch && (
                <MismatchBanner
                    activeContestId={activeContestId}
                    activeContestName={activeContestName}
                    dbActiveContestId={dbActiveContestId}
                />
            )}

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                <Stack gap={6} className="xl:col-span-2">
                    <ActiveContestCard
                        activeContestId={activeContestId}
                        activeContestName={activeContestName}
                        availableContests={availableContests}
                        selectedContestId={selectedContestId}
                        deployPhase={deployState.phase}
                        hasChangedContest={hasChangedContest}
                        onSelectContest={setSelectedContestId}
                        onActivate={handleActivateAndRestart}
                        onCancel={cancelDeploy}
                    />
                    <ContestSettingsForm
                        globalSettings={globalSettings}
                        saving={saving}
                        isDirty={isDirty}
                        onGlobalChange={handleGlobalChange}
                        onSaveSettings={handleSaveSettings}
                    />
                </Stack>
                <WorkersPanel
                    workers={workers}
                    status={liveWorkers}
                    forbidden={workersForbidden}
                    canManage={canManageWorkers}
                    saving={saving}
                    workersDirty={workersDirty}
                    onSaveWorkers={handleSaveWorkers}
                    onAddWorker={addGlobalWorker}
                    onRemoveWorker={removeGlobalWorker}
                    onUpdateWorker={updateGlobalWorker}
                />
            </div>
        </PageContent>
    );
}
