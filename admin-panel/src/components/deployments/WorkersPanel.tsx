'use client';

import { Card } from '@/components/core/Card';
import { Text } from '@/components/core/Typography';
import { Stack } from '@/components/core/Layout';
import { Badge } from '@/components/core/Badge';
import { Save, Server, Trash2, Plus } from 'lucide-react';

export type LiveService = {
    name: string;
    shard: number;
    address: string;
    port: number;
};

export interface WorkerConfig {
    host: string;
    port: number;
}

interface WorkersPanelProps {
    workers: WorkerConfig[];
    liveServices: LiveService[];
    saving: boolean;
    workersDirty: boolean;
    onSaveWorkers: () => void;
    onAddWorker: () => void;
    onRemoveWorker: (index: number) => void;
    onUpdateWorker: (index: number, field: 'host' | 'port', value: string) => void;
}

const normalizeHost = (value: string) => value.trim().toLowerCase();

const isWorkerLive = (worker: WorkerConfig, liveServices: LiveService[]) =>
    liveServices.some(service =>
        service.name === 'Worker' &&
        service.port === worker.port &&
        (normalizeHost(service.address || '') === normalizeHost(worker.host) ||
         normalizeHost(worker.host) === 'localhost' && normalizeHost(service.address || '') === '127.0.0.1')
    );

export function WorkersPanel({
    workers,
    liveServices,
    saving,
    workersDirty,
    onSaveWorkers,
    onAddWorker,
    onRemoveWorker,
    onUpdateWorker
}: WorkersPanelProps) {
    return (
        <Stack gap={6}>
            <Stack direction="row" align="center" gap={2} className="px-2">
                <Text variant="h2">Worker Nodes</Text>
                {workersDirty && (
                    <button
                        onClick={onSaveWorkers}
                        disabled={saving}
                        className="ml-auto flex items-center gap-2 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs transition-colors disabled:opacity-50"
                    >
                        <Save className="w-3 h-3" />
                        Sync Workers
                    </button>
                )}
                <Badge variant="cyan">{workers.length} Configured</Badge>
            </Stack>

            <Card className="glass-card border-white/5 p-6">
                <Text variant="muted" className="mb-4">
                    Workers connect to the EvaluationService and are shared across the active contest.
                </Text>

                <Stack gap={2} className="mb-3">
                    {workers.map((worker, index) => {
                        const live = isWorkerLive(worker, liveServices);
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
                                        onClick={() => onRemoveWorker(index)}
                                        className="p-1 text-neutral-600 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors opacity-0 group-hover:opacity-100"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </Stack>
                                <Stack direction="row" align="center" gap={2}>
                                    <input
                                        type="text"
                                        value={worker.host}
                                        onChange={(e) => onUpdateWorker(index, 'host', e.target.value)}
                                        placeholder="Host (e.g., cms-worker-0)"
                                        className="flex-1 bg-black/40 px-3 py-2 rounded text-sm text-white border border-white/10 outline-none focus:border-cyan-500/50 font-mono"
                                    />
                                    <input
                                        type="number"
                                        value={worker.port}
                                        onChange={(e) => onUpdateWorker(index, 'port', e.target.value)}
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
                    onClick={onAddWorker}
                    className="flex items-center gap-2 px-3 py-2 bg-cyan-600/10 hover:bg-cyan-600/20 text-cyan-400 rounded-lg text-sm transition-colors w-full justify-center font-medium border border-cyan-500/20"
                >
                    <Plus className="w-4 h-4" />
                    Add Worker Node
                </button>
            </Card>
        </Stack>
    );
}
