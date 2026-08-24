'use client';

import { useState } from 'react';
import { Card } from '@/components/core/Card';
import { Text } from '@/components/core/Typography';
import { Stack } from '@/components/core/Layout';
import { Badge } from '@/components/core/Badge';
import { Save, Server, Trash2, Plus, ChevronDown, ChevronUp, Wifi, WifiOff } from 'lucide-react';

export interface WorkerConfig {
    host: string;
    port: number;
}

export type WorkerActivity = 'working' | 'connecting' | 'erroring' | 'idle' | 'unknown';

export interface WorkerLiveDetail {
    host: string;
    port: number;
    shard: number | null;
    state: string;
    health: string;
    restarts: number;
    uptime: string;
    contest: number | null;
    activity: WorkerActivity | string;
    lastLog: string;
    reachable: boolean;
    tasks: number;
    lagging: boolean;
}

interface WorkersPanelProps {
    workers: WorkerConfig[];
    status: WorkerLiveDetail[];
    forbidden?: boolean;
    canManage: boolean;
    saving: boolean;
    workersDirty: boolean;
    onSaveWorkers: () => void;
    onAddWorker: () => void;
    onRemoveWorker: (index: number) => void;
    onUpdateWorker: (index: number, field: 'host' | 'port', value: string) => void;
}

const ACTIVITY_DOT: Record<string, string> = {
    working: 'bg-green-500 animate-pulse',
    idle: 'bg-cyan-500',
    connecting: 'bg-yellow-500 animate-pulse',
    erroring: 'bg-red-500 animate-pulse',
};

const STATE_DOT: Record<string, string> = {
    running: 'bg-cyan-500',
    exited: 'bg-red-500',
    absent: 'bg-neutral-700',
};

function dotFor(detail?: WorkerLiveDetail): { cls: string; label: string; tone: string } {
    if (!detail) return { cls: 'bg-neutral-700', label: 'Unregistered', tone: 'text-neutral-500' };
    const a = ACTIVITY_DOT[detail.activity];
    if (a) {
        const labelMap: Record<string, string> = { working: 'Working', idle: 'Idle', connecting: 'Connecting', erroring: 'Erroring' };
        const toneMap: Record<string, string> = { working: 'text-green-400', idle: 'text-cyan-400', connecting: 'text-yellow-400', erroring: 'text-red-400' };
        return { cls: a, label: labelMap[detail.activity], tone: toneMap[detail.activity] };
    }
    const s = STATE_DOT[detail.state] ?? 'bg-neutral-700';
    const lbl = detail.state === 'running' ? 'Running' : detail.state === 'exited' ? 'Crashed' : detail.state === 'absent' ? 'Not deployed' : detail.state;
    const tone = detail.state === 'exited' ? 'text-red-400' : detail.state === 'running' ? 'text-cyan-400' : 'text-neutral-500';
    return { cls: s, label: lbl, tone };
}

export function WorkersPanel(props: WorkersPanelProps) {
    return <WorkersPanelInner {...props} />;
}

function WorkersPanelInner({
    workers,
    status,
    forbidden,
    canManage,
    saving,
    workersDirty,
    onSaveWorkers,
    onAddWorker,
    onRemoveWorker,
    onUpdateWorker
}: WorkersPanelProps) {
    const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
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

                {forbidden && (
                    <Card className="glass-card border-white/5 p-6 text-center">
                        <Text variant="muted">Worker status requires operator permission.</Text>
                    </Card>
                )}

                <Stack gap={2} className="mb-3">
                    {workers.map((worker, index) => {
                        const detail = status.find(
                            (d) => d.host === worker.host && d.port === worker.port
                        );
                        const dot = dotFor(detail);
                        const expanded = expandedIndex === index;
                        const setExpanded = (v: boolean) => setExpandedIndex(v ? index : null);
                        return (
                            <Stack key={index} gap={1} className="bg-black/20 p-3 rounded-lg border border-white/5 relative group">
                                <Stack direction="row" align="center" justify="between" className="mb-1">
                                    <Stack direction="row" align="center" gap={1.5}>
                                        <div className={`w-2 h-2 rounded-full ${dot.cls}`} />
                                        <Text variant="label" className="text-[10px] uppercase font-bold tracking-widest" color={dot.tone}>
                                            {dot.label}
                                        </Text>
                                        {detail && (
                                            <Badge variant="cyan">{`shard ${detail.shard ?? '-'}`}</Badge>
                                        )}
                                        {detail?.contest != null && (
                                            <Badge variant="neutral">{`contest ${detail.contest}`}</Badge>
                                        )}
                                        {detail?.lagging && (
                                            <Badge variant="red">{`${detail.tasks} queued — lagging`}</Badge>
                                        )}
                                    </Stack>
                                    {canManage && (
                                        <button
                                            onClick={() => onRemoveWorker(index)}
                                            className="p-1 text-neutral-600 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors opacity-0 group-hover:opacity-100"
                                            aria-label={`Remove worker ${worker.host}`}
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    )}
                                </Stack>

                                {canManage ? (
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
                                ) : (
                                    <Text variant="label" color="text-neutral-400" className="font-mono">
                                        {worker.host}:{worker.port}
                                    </Text>
                                )}

                                {detail && (
                                    <>
                                        <Stack direction="row" align="center" gap={2} className="mt-2 flex-wrap text-[11px] text-neutral-400">
                                            <span>state: {detail.state}</span>
                                            {detail.health !== 'none' && <span>health: {detail.health}</span>}
                                            {detail.uptime && <span>up {detail.uptime}</span>}
                                            {detail.restarts > 0 && <span className="text-yellow-400">restarts: {detail.restarts}</span>}
                                            <span className="inline-flex items-center gap-1">
                                                {detail.reachable ? <Wifi className="w-3 h-3 text-green-400" /> : <WifiOff className="w-3 h-3 text-neutral-600" />}
                                                {detail.reachable ? 'reachable' : 'unreachable'}
                                            </span>
                                            <span>{detail.tasks} open task{detail.tasks === 1 ? '' : 's'}</span>
                                            <button
                                                onClick={() => setExpanded(!expanded)}
                                                className="ml-auto inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300"
                                            >
                                                {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                                log
                                            </button>
                                        </Stack>
                                        {expanded && detail.lastLog && (
                                            <pre className="mt-1 p-2 bg-black/50 rounded text-[11px] text-neutral-300 overflow-x-auto whitespace-pre-wrap">
                                                {detail.lastLog}
                                            </pre>
                                        )}
                                    </>
                                )}
                                {!detail && !forbidden && (
                                    <Text variant="label" color="text-neutral-500" className="text-[11px] mt-1">
                                        No telemetry yet — is this worker deployed?
                                    </Text>
                                )}
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
