'use client';

import { useState } from 'react';
import { Card } from '@/components/core/Card';
import { Text } from '@/components/core/Typography';
import { Stack } from '@/components/core/Layout';
import { Badge } from '@/components/core/Badge';
import { Button } from '@/components/core/Button';
import { EmptyState } from '@/components/core/EmptyState';
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
    working: 'bg-success animate-pulse',
    idle: 'bg-info',
    connecting: 'bg-warning animate-pulse',
    erroring: 'bg-destructive animate-pulse',
};

const STATE_DOT: Record<string, string> = {
    running: 'bg-info',
    exited: 'bg-destructive',
    absent: 'bg-muted-foreground/40',
};

function dotFor(detail?: WorkerLiveDetail): { cls: string; label: string; tone: string } {
    if (!detail) return { cls: 'bg-muted-foreground/40', label: 'Unregistered', tone: 'text-muted-foreground' };
    const a = ACTIVITY_DOT[detail.activity];
    if (a) {
        const labelMap: Record<string, string> = { working: 'Working', idle: 'Idle', connecting: 'Connecting', erroring: 'Erroring' };
        const toneMap: Record<string, string> = { working: 'text-success', idle: 'text-info', connecting: 'text-warning', erroring: 'text-destructive' };
        return { cls: a, label: labelMap[detail.activity], tone: toneMap[detail.activity] };
    }
    const s = STATE_DOT[detail.state] ?? 'bg-muted-foreground/40';
    const lbl = detail.state === 'running' ? 'Running' : detail.state === 'exited' ? 'Crashed' : detail.state === 'absent' ? 'Not deployed' : detail.state;
    const tone = detail.state === 'exited' ? 'text-destructive' : detail.state === 'running' ? 'text-info' : 'text-muted-foreground';
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
                    <Button
                        onClick={onSaveWorkers}
                        disabled={saving}
                        size="sm"
                        className="ml-auto"
                    >
                        <Save className="w-3 h-3 mr-1.5" />
                        Sync Workers
                    </Button>
                )}
                <Badge variant="info">{workers.length} Configured</Badge>
            </Stack>

            <Card className="p-6">
                <Text variant="muted" className="mb-4">
                    Workers connect to the EvaluationService and are shared across the active contest.
                </Text>

                {forbidden && (
                    <Card className="p-6 text-center">
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
                            <Stack key={index} gap={1} data-shortcut-row className="bg-muted/30 p-3 rounded-lg border border-border relative group">
                                <Stack direction="row" align="center" justify="between" className="mb-1">
                                    <Stack direction="row" align="center" gap={1.5}>
                                        <div className={`w-2 h-2 rounded-full ${dot.cls}`} />
                                        <Text variant="label" className="text-xs uppercase font-bold tracking-widest" color={dot.tone}>
                                            {dot.label}
                                        </Text>
                                        {detail && (
                                            <Badge variant="info">{`shard ${detail.shard ?? '-'}`}</Badge>
                                        )}
                                        {detail?.contest != null && (
                                            <Badge variant="neutral">{`contest ${detail.contest}`}</Badge>
                                        )}
                                        {detail?.lagging && (
                                            <Badge variant="destructive">{`${detail.tasks} queued — lagging`}</Badge>
                                        )}
                                    </Stack>
                                    {canManage && (
                                        <button
                                            onClick={() => onRemoveWorker(index)}
                                            className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition-colors opacity-0 group-hover:opacity-100"
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
                                            className="flex-1 bg-background/80 px-3 py-2 rounded text-sm text-foreground border border-border outline-none focus:border-ring/60 font-mono"
                                        />
                                        <input
                                            type="number"
                                            value={worker.port}
                                            onChange={(e) => onUpdateWorker(index, 'port', e.target.value)}
                                            placeholder="26000"
                                            className="w-24 bg-background/80 px-3 py-2 rounded text-sm text-foreground border border-border outline-none focus:border-ring/60 font-mono"
                                        />
                                    </Stack>
                                ) : (
                                    <Text variant="label" color="text-muted-foreground" className="font-mono">
                                        {worker.host}:{worker.port}
                                    </Text>
                                )}

                                {detail && (
                                    <>
                                        <Stack direction="row" align="center" gap={2} className="mt-2 flex-wrap text-xs text-muted-foreground">
                                            <span>state: {detail.state}</span>
                                            {detail.health !== 'none' && <span>health: {detail.health}</span>}
                                            {detail.uptime && <span>up {detail.uptime}</span>}
                                            {detail.restarts > 0 && <span className="text-warning">restarts: {detail.restarts}</span>}
                                            <span className="inline-flex items-center gap-1">
                                                {detail.reachable ? <Wifi className="w-3 h-3 text-success" /> : <WifiOff className="w-3 h-3 text-muted-foreground" />}
                                                {detail.reachable ? 'reachable' : 'unreachable'}
                                            </span>
                                            <span>{detail.tasks} open task{detail.tasks === 1 ? '' : 's'}</span>
                                            <button
                                                onClick={() => setExpanded(!expanded)}
                                                className="ml-auto inline-flex items-center gap-1 text-info hover:text-info/80"
                                            >
                                                {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                                log
                                            </button>
                                        </Stack>
                                        {expanded && detail.lastLog && (
                                            <pre className="mt-1 p-2 bg-background/80 rounded text-xs text-muted-foreground overflow-x-auto whitespace-pre-wrap">
                                                {detail.lastLog}
                                            </pre>
                                        )}
                                    </>
                                )}
                                {!detail && !forbidden && (
                                    <Text variant="label" color="text-muted-foreground" className="text-xs mt-1">
                                        No telemetry yet — is this worker deployed?
                                    </Text>
                                )}
                            </Stack>
                        );
                    })}

                    {workers.length === 0 && (
                        <EmptyState
                            icon={Server}
                            title="No workers configured"
                            className="border-none"
                        />
                    )}
                </Stack>

                <Button
                    onClick={onAddWorker}
                    variant="positiveOutline"
                    className="w-full justify-center"
                >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Worker Node
                </Button>
            </Card>
        </Stack>
    );
}
