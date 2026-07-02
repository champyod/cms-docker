'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/core/Card';
import { readEnvFile, updateEnvFile } from '@/app/actions/env';
import { getAvailableContests } from '@/app/actions/contests';
import { getWorkers, updateWorkers } from '@/app/actions/workerConfig';
import { getLiveServiceConnections, restartServices, getServiceStatus } from '@/app/actions/services';
import { saveAndRestartContest } from '@/app/actions/services';
import { activateContest } from '@/app/actions/contests';
import { Save, RefreshCw, AlertTriangle, Globe, Server, Rocket, Shield } from 'lucide-react';
import { PageContent, PageHeader, Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';
import { Badge } from '@/components/core/Badge';
import { Loading } from '@/components/core/Loading';
import { useToast } from '@/components/providers/ToastProvider';

type LiveService = {
    name: string;
    shard: number;
    address: string;
    port: number;
};

export function DeploymentsClient() {
    const { addToast } = useToast();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [availableContests, setAvailableContests] = useState<{ id: number; name: string }[]>([]);
    const [activeContestId, setActiveContestId] = useState<number | null>(null);
    const [activeContestName, setActiveContestName] = useState<string | null>(null);
    const [selectedContestId, setSelectedContestId] = useState<number | null>(null);
    const [globalSettings, setGlobalSettings] = useState<Record<string, string>>({});
    const [originalGlobal, setOriginalGlobal] = useState<string>('{}');
    const [workers, setWorkers] = useState<{ host: string; port: number }[]>([]);
    const [originalWorkers, setOriginalWorkers] = useState<string>('[]');
    const [liveServices, setLiveServices] = useState<LiveService[]>([]);
    const [serviceStatus, setServiceStatus] = useState<{ status: string; running: number; total: number }>({ status: 'down', running: 0, total: 0 });

    const isDirty = JSON.stringify(globalSettings) !== originalGlobal ||
                    JSON.stringify(workers) !== originalWorkers;
    const hasChangedContest = selectedContestId !== null && selectedContestId !== activeContestId;

    const loadData = async () => {
        setLoading(true);
        const [envResult, contestsResult, workersResult, servicesResult, statusResult] = await Promise.all([
            readEnvFile('.env.contest'),
            getAvailableContests(),
            getWorkers(),
            getLiveServiceConnections(),
            getServiceStatus()
        ]);

        if (envResult.success && envResult.config) {
            const activeId = parseInt(envResult.config.ACTIVE_CONTEST_ID || envResult.config.CONTEST_ID || '0');
            const actualActiveId = activeId > 0 ? activeId : null;
            setActiveContestId(actualActiveId);
            setSelectedContestId(actualActiveId);

            const globals = { ...envResult.config };
            delete globals.ACTIVE_CONTEST_ID;
            delete globals.CONTEST_ID;
            setGlobalSettings(globals);
            setOriginalGlobal(JSON.stringify(globals));
        }

        const databaseContests = contestsResult.success ? contestsResult.contests : [];
        setAvailableContests(databaseContests);

        if (activeContestId && databaseContests.length > 0) {
            const match = databaseContests.find((c: { id: number; name: string }) => c.id === activeContestId);
            if (match) setActiveContestName(match.name);
        }

        const normalizedWorkers = Array.isArray(workersResult) ? workersResult : [];
        setWorkers(normalizedWorkers);
        setOriginalWorkers(JSON.stringify(normalizedWorkers));

        if (servicesResult.success) setLiveServices(servicesResult.services);
        if (statusResult) setServiceStatus(statusResult);

        setLoading(false);
    };

    useEffect(() => { loadData(); }, []);

    const handleActivateAndRestart = async () => {
        if (!selectedContestId || !hasChangedContest) return;
        setSaving(true);
        try {
            // 1. Activate in DB
            const activateResult = await activateContest(selectedContestId);
            if (!activateResult.success) {
                addToast({ type: 'error', title: 'Failed', message: activateResult.error || 'Could not activate contest' });
                setSaving(false);
                return;
            }
            // 2. Update env and restart stack
            const restartResult = await saveAndRestartContest(selectedContestId);
            if (!restartResult.success) {
                addToast({ type: 'error', title: 'Restart Failed', message: restartResult.error || 'Contest stack restart failed. You may need to restart manually.' });
                setSaving(false);
                return;
            }
            setActiveContestId(selectedContestId);
            const match = availableContests.find(c => c.id === selectedContestId);
            if (match) setActiveContestName(match.name);
            addToast({ type: 'success', title: 'Contest Activated', message: `Contest #${selectedContestId} is now active and stack restarted.` });
        } catch (error) {
            addToast({ type: 'error', title: 'Unexpected Error', message: (error as Error).message });
        } finally {
            setSaving(false);
        }
    };

    const handleSaveSettings = async () => {
        setSaving(true);
        try {
            const workerResult = await updateWorkers(workers);
            if (!workerResult.success) {
                addToast({ type: 'error', title: 'Worker Config Failed', message: workerResult.error || 'Could not save worker config' });
                setSaving(false);
                return;
            }
            const result = await updateEnvFile('.env.contest', globalSettings);
            if (!result.success) {
                addToast({ type: 'error', title: 'Save Failed', message: result.error || 'Could not update env file' });
                setSaving(false);
                return;
            }
            setOriginalGlobal(JSON.stringify(globalSettings));
            setOriginalWorkers(JSON.stringify(workers));
            addToast({ type: 'success', title: 'Settings Saved', message: 'Global settings updated.' });
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

    const normalizeHost = (value: string) => value.trim().toLowerCase();
    const isWorkerLive = (worker: { host: string; port: number }) =>
        liveServices.some(service =>
            service.name === 'Worker' &&
            service.port === worker.port &&
            (normalizeHost(service.address || '') === normalizeHost(worker.host) ||
             normalizeHost(worker.host) === 'localhost' && normalizeHost(service.address || '') === '127.0.0.1')
        );

    const statusColor = serviceStatus.status === 'ok' ? 'emerald' : serviceStatus.status === 'degraded' ? 'amber' : 'red';
    const statusLabel = serviceStatus.status === 'ok' ? 'Running' : serviceStatus.status === 'degraded' ? 'Degraded' : 'Down';

    if (loading) return <Loading text="Loading contest deployment..." fullScreen />;

    return (
        <PageContent className="pb-20">
            <PageHeader
                title="Active Contest Deployment"
                description="Select, activate, and manage the currently deployed contest stack."
            />

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                <Stack gap={6} className="xl:col-span-2">
                    {/* Active Contest Card */}
                    <Card className="bg-white/2 p-6 border border-white/5">
                        <Stack gap={5}>
                            <Stack direction="row" align="center" justify="between">
                                <Stack direction="row" align="center" gap={3}>
                                    <Rocket className="w-6 h-6 text-indigo-400" />
                                    <Text variant="h2">Current Active Contest</Text>
                                </Stack>
                                <Badge variant={statusColor as 'indigo' | 'emerald' | 'amber' | 'red' | 'cyan' | 'neutral'}>
                                    {serviceStatus.running}/{serviceStatus.total} {statusLabel}
                                </Badge>
                            </Stack>

                            {activeContestId && (
                                <div className="flex items-center gap-4 p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-xl">
                                    <div className="w-12 h-12 rounded-xl bg-indigo-600/20 flex items-center justify-center text-indigo-400 font-bold text-lg">
                                        #{activeContestId}
                                    </div>
                                    <div>
                                        <Text variant="h3" color="text-white">{activeContestName || `Contest #${activeContestId}`}</Text>
                                        <Text variant="small" color="text-neutral-400">Currently deployed contest stack</Text>
                                    </div>
                                </div>
                            )}

                            {!activeContestId && (
                                <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                                    <Stack direction="row" align="center" gap={3}>
                                        <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
                                        <div>
                                            <Text variant="h3" color="text-amber-400">No Active Contest</Text>
                                            <Text variant="small" color="text-neutral-400">Select a contest below and activate it.</Text>
                                        </div>
                                    </Stack>
                                </div>
                            )}

                            {/* Contest Selector */}
                            <Stack gap={2}>
                                <Text variant="label" className="flex items-center gap-2">
                                    <Rocket className="w-3 h-3" />
                                    Select Contest to Deploy
                                </Text>
                                <Stack direction="row" align="center" gap={3}>
                                    <select
                                        value={selectedContestId ?? ''}
                                        onChange={(e) => setSelectedContestId(e.target.value ? parseInt(e.target.value) : null)}
                                        className="flex-1 bg-black/40 px-4 py-2.5 rounded-lg border border-white/10 text-white text-sm outline-none focus:border-indigo-500/50 appearance-none cursor-pointer"
                                    >
                                        <option value="" className="bg-neutral-900">-- Select a contest --</option>
                                        {availableContests.map((contest) => (
                                            <option key={contest.id} value={contest.id} className="bg-neutral-900">
                                                #{contest.id} - {contest.name}
                                            </option>
                                        ))}
                                    </select>
                                    <button
                                        onClick={handleActivateAndRestart}
                                        disabled={saving || !hasChangedContest || !selectedContestId}
                                        className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white rounded-lg transition-colors font-medium shadow-lg shadow-indigo-900/20 disabled:shadow-none"
                                    >
                                        <RefreshCw className={`w-4 h-4 ${saving ? 'animate-spin' : ''}`} />
                                        {saving ? 'Deploying...' : 'Activate & Restart Stack'}
                                    </button>
                                </Stack>
                                <Text variant="small" color="text-neutral-500">
                                    This will update the env file, mark the contest as active in the database, and restart the contest stack.
                                </Text>
                            </Stack>
                        </Stack>
                    </Card>

                    {/* Global Settings (moved here from sidebar) */}
                    <Stack gap={4}>
                        <Stack direction="row" align="center" gap={2} className="px-2">
                            <Shield className="w-5 h-5 text-indigo-400" />
                            <Text variant="h2">Global Settings</Text>
                            {isDirty && (
                                <button
                                    onClick={handleSaveSettings}
                                    disabled={saving}
                                    className="ml-auto flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs transition-colors disabled:opacity-50"
                                >
                                    <Save className="w-3 h-3" />
                                    Save Settings
                                </button>
                            )}
                        </Stack>

                        <Card className="glass-card border-white/5 p-6 space-y-6">
                            <Stack gap={1}>
                                <Text variant="label">Security Secret Key</Text>
                                <input
                                    type="password"
                                    value={globalSettings.SECRET_KEY || ''}
                                    onChange={(e) => handleGlobalChange('SECRET_KEY', e.target.value)}
                                    className="w-full bg-black/40 px-4 py-2 rounded-lg border border-white/10 text-white outline-none focus:border-indigo-500/50 font-mono text-xs"
                                    placeholder="Generated automatically if empty"
                                    autoComplete="off"
                                    data-form-type="other"
                                />
                            </Stack>

                            <div className="grid grid-cols-2 gap-4">
                                <Stack gap={1}>
                                    <Text variant="label">CPU Limit</Text>
                                    <input
                                        type="text"
                                        value={globalSettings.CONTEST_WEB_CPU_LIMIT || ''}
                                        onChange={(e) => handleGlobalChange('CONTEST_WEB_CPU_LIMIT', e.target.value)}
                                        className="w-full bg-black/40 px-4 py-2 rounded-lg border border-white/10 text-white outline-none focus:border-indigo-500/50 text-sm"
                                        placeholder="e.g. 2"
                                    />
                                </Stack>
                                <Stack gap={1}>
                                    <Text variant="label">Mem Limit</Text>
                                    <input
                                        type="text"
                                        value={globalSettings.CONTEST_WEB_MEMORY_LIMIT || ''}
                                        onChange={(e) => handleGlobalChange('CONTEST_WEB_MEMORY_LIMIT', e.target.value)}
                                        className="w-full bg-black/40 px-4 py-2 rounded-lg border border-white/10 text-white outline-none focus:border-indigo-500/50 text-sm"
                                        placeholder="e.g. 2G"
                                    />
                                </Stack>
                            </div>

                            <Stack gap={1}>
                                <Text variant="label">Cookie Duration (s)</Text>
                                <input
                                    type="number"
                                    value={globalSettings.COOKIE_DURATION || ''}
                                    onChange={(e) => handleGlobalChange('COOKIE_DURATION', e.target.value)}
                                    className="w-full bg-black/40 px-4 py-2 rounded-lg border border-white/10 text-white outline-none focus:border-indigo-500/50 text-sm"
                                    placeholder="10800"
                                />
                            </Stack>

                            <Stack gap={4} className="pt-4 border-t border-white/5">
                                <Stack direction="row" align="center" gap={2}>
                                    <input
                                        type="checkbox"
                                        id="tls"
                                        checked={globalSettings.ENABLE_TLS === 'true'}
                                        onChange={(e) => handleGlobalChange('ENABLE_TLS', e.target.checked ? 'true' : 'false')}
                                        className="rounded border-white/10 bg-black/40 text-indigo-600 focus:ring-indigo-500"
                                    />
                                    <label htmlFor="tls" className="text-xs text-neutral-300">Enable HTTPS (Traefik)</label>
                                </Stack>
                                <Stack direction="row" align="center" gap={2}>
                                    <input
                                        type="checkbox"
                                        id="localCopy"
                                        checked={globalSettings.SUBMIT_LOCAL_COPY === 'true'}
                                        onChange={(e) => handleGlobalChange('SUBMIT_LOCAL_COPY', e.target.checked ? 'true' : 'false')}
                                        className="rounded border-white/10 bg-black/40 text-indigo-600 focus:ring-indigo-500"
                                    />
                                    <label htmlFor="localCopy" className="text-xs text-neutral-300">Store Local Copy of Submissions</label>
                                </Stack>
                            </Stack>
                        </Card>
                    </Stack>
                </Stack>

                {/* Right Column: Worker Nodes */}
                <Stack gap={6}>
                    <Stack direction="row" align="center" gap={2} className="px-2">
                        <Server className="w-5 h-5 text-cyan-400" />
                        <Text variant="h2">Worker Nodes</Text>
                        <Badge variant="cyan" className="ml-auto">{workers.length} Configured</Badge>
                    </Stack>

                    <Card className="glass-card border-white/5 p-6">
                        <Text variant="muted" className="mb-4">
                            Workers connect to the EvaluationService and are shared across the active contest.
                        </Text>

                        <Stack gap={2} className="mb-3">
                            {workers.map((worker, index) => {
                                const live = isWorkerLive(worker);
                                return (
                                    <Stack key={index} gap={1} className="bg-black/20 p-3 rounded-lg border border-white/5 relative group">
                                        <Stack direction="row" align="center" justify="between" className="mb-1">
                                            <Stack direction="row" align="center" gap={1.5}>
                                                <div className={`w-2 h-2 rounded-full ${live ? 'bg-cyan-500 animate-pulse' : 'bg-neutral-700'}`} />
                                                <Text variant="label" className="text-[10px] uppercase font-bold tracking-widest" color={live ? 'text-cyan-400' : 'text-neutral-500'}>
                                                    {live ? 'Live' : 'Offline'}
                                                </Text>
                                            </Stack>
                                            <button
                                                onClick={() => removeGlobalWorker(index)}
                                                className="p-1 text-neutral-600 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors opacity-0 group-hover:opacity-100"
                                            >
                                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                            </button>
                                        </Stack>
                                        <Stack direction="row" align="center" gap={2}>
                                            <input
                                                type="text"
                                                value={worker.host}
                                                onChange={(e) => updateGlobalWorker(index, 'host', e.target.value)}
                                                placeholder="Host (e.g., cms-worker-0)"
                                                className="flex-1 bg-black/40 px-3 py-2 rounded text-sm text-white border border-white/10 outline-none focus:border-cyan-500/50 font-mono"
                                            />
                                            <input
                                                type="number"
                                                value={worker.port}
                                                onChange={(e) => updateGlobalWorker(index, 'port', e.target.value)}
                                                placeholder="26000"
                                                className="w-24 bg-black/40 px-3 py-2 rounded text-sm text-white border border-white/10 outline-none focus:border-cyan-500/50 font-mono"
                                            />
                                        </Stack>
                                    </Stack>
                                );
                            })}

                            {workers.length === 0 && (
                                <Stack align="center" justify="center" className="p-6 bg-black/20 rounded-lg border border-white/5">
                                    <Server className="w-8 h-8 text-neutral-700 mx-auto mb-2" />
                                    <Text variant="label" color="text-neutral-500">No workers configured</Text>
                                </Stack>
                            )}
                        </Stack>

                        <button
                            onClick={addGlobalWorker}
                            className="flex items-center gap-2 px-3 py-2 bg-cyan-600/10 hover:bg-cyan-600/20 text-cyan-400 rounded-lg text-sm transition-colors w-full justify-center font-medium border border-cyan-500/20"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                            Add Worker Node
                        </button>
                    </Card>
                </Stack>
            </div>
        </PageContent>
    );
}
