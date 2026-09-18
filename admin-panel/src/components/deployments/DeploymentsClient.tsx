'use client';

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { readActiveContestId, readConfigTomlValues, updateConfigTomlValues } from '@/app/actions/env';
import { buildConfigTomlUpdates, type ConfigTomlKey } from '@/lib/config-toml';
import { getAvailableContests } from '@/app/actions/contests';
import { settleDeployOperations } from '@/app/actions/services';
import { getContainerContestId } from '@/app/actions/docker';
import { useDeployContest } from '@/hooks/useDeployContest';
import { PageContent, PageHeader, Stack } from '@/components/core/Layout';
import { Loading } from '@/components/core/Loading';
import { Button } from '@/components/core/Button';
import { toast } from 'sonner';
import { MismatchBanner } from '@/components/deployments/MismatchBanner';
import { DeployStatusPanel } from '@/components/deployments/DeployStatusPanel';
import { ActiveContestCard, ContestOption } from '@/components/deployments/ActiveContestCard';
import { ContestSettingsForm } from '@/components/deployments/ContestSettingsForm';
import { WorkersPanel } from '@/components/deployments/WorkersPanel';
import { useDeployWorkers } from '@/components/deployments/useDeployWorkers';

// The contest settings this screen edits, all in config.toml [contest]. They used to be
// read from and written to .env.contest, which compose never loads and no script generates:
// the write never reached the running stack, and a config sync could not have kept it.
const CONTEST_SETTINGS_KEYS: readonly ConfigTomlKey[] = [
    { section: 'contest', key: 'CONTEST_WEB_CPU_LIMIT' },
    { section: 'contest', key: 'CONTEST_WEB_MEMORY_LIMIT' },
    { section: 'contest', key: 'COOKIE_DURATION' },
    { section: 'contest', key: 'ENABLE_TLS' },
    { section: 'contest', key: 'SUBMIT_LOCAL_COPY' },
];

export function DeploymentsClient() {
    const { state: deployState, deploy: handleDeploy, cancel: cancelDeploy, reset: resetDeploy } = useDeployContest();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [availableContests, setAvailableContests] = useState<ContestOption[]>([]);
    const [activeContestId, setActiveContestId] = useState<number | null>(null);
    const [activeContestName, setActiveContestName] = useState<string | null>(null);
    const [dbActiveContestId, setDbActiveContestId] = useState<number | null>(null);
    const [containerContestId, setContainerContestId] = useState<number | null>(null);
    const [selectedContestId, setSelectedContestId] = useState<number | null>(null);
    const [globalSettings, setGlobalSettings] = useState<Record<string, string>>({});
    const [originalGlobal, setOriginalGlobal] = useState<string>('{}');

    const {
        workers,
        workersDirty,
        liveWorkers,
        workersForbidden,
        canManageWorkers,
        handleSaveWorkers,
        addGlobalWorker,
        removeGlobalWorker,
        updateGlobalWorker,
    } = useDeployWorkers(setSaving);

    const isDirty = JSON.stringify(globalSettings) !== originalGlobal;
    const hasChangedContest = selectedContestId !== null && selectedContestId !== activeContestId;

    const applyContestSnapshot = useCallback((settings: Record<string, string>, activeId: number | null) => {
        // Both the active id and the settings below come from config.toml, the file
        // `./cms config sync` regenerates .env from — the id from [contest] CONTEST_ID,
        // the settings from the same section.
        setActiveContestId(activeId);
        setSelectedContestId(activeId);
        setGlobalSettings(settings);
        setOriginalGlobal(JSON.stringify(settings));
        return activeId;
    }, []);

    const loadData = useCallback(async (options?: { silent?: boolean }) => {
        if (options?.silent !== true) setLoading(true);
        try {
            // Why the settle comes before the reads: a deploy that finished while nothing watched its
            // operation still owes its activation (or its rollback), and the values read below are only
            // the truth about the stack once that has run.
            await settleDeployOperations();
        } catch {
            // A settle that could not run leaves what it owes on the operation's own record, which the
            // next visit retries. Failing the screen instead would hide the deploy state the operator
            // came to read.
        }
        const [activeResult, settingsResult, contestsResult, containerResult] = await Promise.all([
            readActiveContestId(),
            readConfigTomlValues(CONTEST_SETTINGS_KEYS),
            getAvailableContests(),
            getContainerContestId()
        ]);

        const actualActiveId = applyContestSnapshot(
            settingsResult.success ? settingsResult.values : {},
            activeResult.success ? activeResult.contestId : null,
        );
        setContainerContestId(containerResult.success ? containerResult.contestId : null);

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

        setLoading(false);
    }, [applyContestSnapshot]);

    useEffect(() => {
        queueMicrotask(() => void loadData());
    }, [loadData]);

    const handleActivateAndRestart = () => {
        if (!selectedContestId || !hasChangedContest) return;
        setSaving(true);
        handleDeploy(selectedContestId);
    };

    const handleRefresh = () => {
        loadData();
    };

    // Why only the spinner is handled here: the deploy's own toast comes from useDeployContest's status
    // stream, and the values a terminal phase changes are re-read by the effect below. The deploy is
    // over either way, so the button stops loading.
    useEffect(() => {
        const terminal = deployState.phase === 'completed'
            || deployState.phase === 'failed'
            || deployState.phase === 'timeout'
            || deployState.phase === 'already_running';
        if (terminal || (deployState.phase === 'idle' && saving)) setSaving(false);
    }, [deployState.phase, saving]);

    // Why every source is re-read at every terminal phase: the operation settles server side — activating
    // its contest, or rolling the configuration back — and can settle after this panel last read the
    // database. A value held from before that settle reports a mismatch the deploy has already resolved.
    // loadData is that read, and it takes all three sources in one pass: config.toml [contest] CONTEST_ID,
    // the database rows, and the id the running container serves.
    useEffect(() => {
        const ended = deployState.phase === 'completed' || deployState.phase === 'failed' || deployState.phase === 'timeout';
        if (!ended) return;
        // Why the id is applied before the read rather than after it: the card stays on the contest this
        // panel just deployed while the reads are in flight, and the read — not this line — is what the
        // values on screen come from once it answers. Only a completed deploy applies it: a failed one
        // leaves config.toml on whatever its rollback restored, and the read is what says so.
        if (deployState.phase === 'completed' && deployState.contestId !== null) setActiveContestId(deployState.contestId);
        void loadData({ silent: true });
    }, [deployState.phase, deployState.contestId, loadData]);

    const handleSaveSettings = async () => {
        setSaving(true);
        try {
            const result = await updateConfigTomlValues(buildConfigTomlUpdates(globalSettings, CONTEST_SETTINGS_KEYS));
            if (!result.success) {
                toast.error('Save Failed', { description: result.error || 'Could not update config.toml' });
                setSaving(false);
                return;
            }
            setOriginalGlobal(JSON.stringify(globalSettings));
            toast.success('Settings Saved', { description: 'Contest settings updated.' });
        } catch (error) {
            toast.error('Unexpected Error', { description: (error as Error).message });
        } finally {
            setSaving(false);
        }
    };

    const handleGlobalChange = (key: string, val: string) => {
        setGlobalSettings(prev => ({ ...prev, [key]: val }));
    };

    const hasMismatch = !deployState.phase.startsWith('deploy') && !deployState.phase.startsWith('poll') && activeContestId !== null && dbActiveContestId !== null
        && (activeContestId !== dbActiveContestId
            || (containerContestId !== null && (activeContestId !== containerContestId || dbActiveContestId !== containerContestId)));

    if (loading) return <Loading text="Loading contest deployment..." fullScreen />;

    return (
        <PageContent className="pb-20">
            <PageHeader
                title="Active Contest Deployment"
                description="Select, activate, and manage the currently deployed contest stack."
                actions={
                    <Button variant="secondary" size="sm" icon={RefreshCw} onClick={handleRefresh}>
                        Refresh
                    </Button>
                }
            />

            {deployState.phase !== 'idle' && (
                <DeployStatusPanel
                    state={deployState}
                    onCancel={cancelDeploy}
                    onReset={resetDeploy}
                />
            )}

            {hasMismatch && (
                <MismatchBanner
                    activeContestId={activeContestId}
                    activeContestName={activeContestName}
                    dbActiveContestId={dbActiveContestId}
                    containerContestId={containerContestId}
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
