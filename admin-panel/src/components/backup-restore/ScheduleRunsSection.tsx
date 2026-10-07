'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, History, RefreshCw } from 'lucide-react';

import { listRuns, listSchedules } from '@/app/actions/schedules';
// Type-only: the runtime module reaches Prisma and must stay out of the client bundle.
import type { BackupRun } from '@/app/actions/schedules';
import { Badge } from '@/components/core/Badge';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { EmptyState } from '@/components/core/EmptyState';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';
import { RUN_STATUS_FAILED, RUN_STATUS_SETTLED, RUN_STATUS_STARTED } from '@/scheduler/tick';
import { summarizeTables } from '@/components/backup-restore/ScheduleSection';
import { useSettleRun } from '@/components/backup-restore/useSchedules';
import type { Notice } from '@/components/backup-restore/useSchedules';

/** The action clamps any larger value to its own maximum, so this only bounds the row count. */
const RUN_HISTORY_LIMIT = 50;
const RUNS_ERROR = 'Could not read the backup run history.';
const NAMES_ERROR = 'Could not read the backup schedule names.';
const MANUAL_SOURCE = 'Manual';
const UNKNOWN_SOURCE = 'Deleted schedule';

type BadgeVariant = 'success' | 'warning' | 'destructive' | 'neutral';

const STATUS_VARIANT: Readonly<Record<string, BadgeVariant>> = {
    started: 'warning',
    launched: 'success',
    failed: 'destructive',
    settled: 'neutral',
};

const MESSAGE_STATUSES: ReadonlySet<string> = new Set([RUN_STATUS_FAILED, RUN_STATUS_SETTLED]);

function isUnfinished(run: BackupRun): boolean {
    return run.status === RUN_STATUS_STARTED;
}

function describeError(error: unknown, fallback: string): string {
    return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

function statusVariant(status: string): BadgeVariant {
    return STATUS_VARIANT[status] ?? 'neutral';
}

function formatWhen(date: Date | null, fallback: string): string {
    return date === null ? fallback : date.toLocaleString();
}

function sourceLabel(run: BackupRun, scheduleNames: ReadonlyMap<string, string>): string {
    if (run.scheduleId === null) return MANUAL_SOURCE;
    return scheduleNames.get(run.scheduleId) ?? UNKNOWN_SOURCE;
}

function useRunHistory() {
    const [runs, setRuns] = useState<readonly BackupRun[]>([]);
    const [scheduleNames, setScheduleNames] = useState<ReadonlyMap<string, string>>(new Map());
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    const reload = useCallback(async () => {
        setIsLoading(true);
        setLoadError(null);
        try {
            const [runsResult, schedulesResult] = await Promise.all([
                listRuns(RUN_HISTORY_LIMIT),
                listSchedules(),
            ]);
            if (!schedulesResult.success) {
                setRuns([]);
                setLoadError(schedulesResult.error ?? NAMES_ERROR);
                return;
            }
            if (!runsResult.success) {
                setRuns([]);
                setLoadError(runsResult.error ?? RUNS_ERROR);
                return;
            }
            setScheduleNames(new Map((schedulesResult.schedules ?? []).map((entry) => [entry.id, entry.name])));
            setRuns(runsResult.runs ?? []);
        } catch (error) {
            setRuns([]);
            setLoadError(describeError(error, RUNS_ERROR));
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        void reload();
    }, [reload]);

    return { runs, scheduleNames, isLoading, loadError, reload };
}

interface RunRowProps {
    readonly run: BackupRun;
    readonly scheduleNames: ReadonlyMap<string, string>;
    readonly isSettling: boolean;
    readonly onSettle: (runId: string) => void;
    readonly feedback: Notice | undefined;
}

function RunRow({ run, scheduleNames, isSettling, onSettle, feedback }: RunRowProps) {
    return (
        <li className="px-3 py-3">
            <Stack gap={2}>
                <Stack direction="row" align="center" gap={3} wrap>
                    <div className="min-w-0 mr-auto">
                        <p className="text-sm font-medium text-white truncate">{sourceLabel(run, scheduleNames)}</p>
                        <p className="text-xs text-muted-foreground truncate">{summarizeTables(run.tables)}</p>
                    </div>
                    <Badge variant="indigo">{run.kind}</Badge>
                    <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
                    {isUnfinished(run) && (
                        <Button
                            size="sm"
                            variant="secondary"
                            icon={CheckCircle2}
                            loading={isSettling}
                            onClick={() => onSettle(run.id)}
                        >
                            Settle
                        </Button>
                    )}
                </Stack>
                <Text variant="small" color="text-muted-foreground">
                    Started {formatWhen(run.startedAt, 'unknown')} &middot; finished{' '}
                    {formatWhen(run.finishedAt, 'not finished')}
                </Text>
                {run.message !== null && MESSAGE_STATUSES.has(run.status) && (
                    <Text variant="small" className={run.status === RUN_STATUS_FAILED ? 'text-destructive' : 'text-muted-foreground'}>
                        {run.message}
                    </Text>
                )}
                {feedback !== undefined && (
                    <Text
                        variant="small"
                        role="status"
                        className={feedback.tone === 'error' ? 'text-destructive' : 'text-muted-foreground'}
                    >
                        {feedback.message}
                    </Text>
                )}
            </Stack>
        </li>
    );
}

export function ScheduleRunsSection() {
    const { runs, scheduleNames, isLoading, loadError, reload } = useRunHistory();
    const { busyRunId, feedback, settle } = useSettleRun(reload);

    return (
        <Card className="p-6">
            <Stack gap={6}>
                <Stack direction="row" align="center" gap={3}>
                    <div className="p-2 bg-teal-500/10 rounded-lg">
                        <History className="w-5 h-5 text-teal-400" />
                    </div>
                    <Text variant="h2" className="mr-auto">
                        Backup Run History
                    </Text>
                    <Button size="sm" variant="secondary" icon={RefreshCw} loading={isLoading} onClick={() => void reload()}>
                        Refresh
                    </Button>
                </Stack>

                <Text variant="small" color="text-muted-foreground">
                    Newest first, last {RUN_HISTORY_LIMIT} runs. A launch reports its outcome on Discord and in the
                    archive browser, so a run stays <span className="font-mono">launched</span> after its dump
                    finishes. A run stuck in <span className="font-mono">started</span> blocks its schedule; settle it
                    once you have checked the real result.
                </Text>

                {loadError !== null ? (
                    <Text variant="small" role="alert" className="text-destructive">
                        {loadError}
                    </Text>
                ) : isLoading ? (
                    <Text variant="small" color="text-muted-foreground">
                        Loading run history...
                    </Text>
                ) : runs.length === 0 ? (
                    <EmptyState
                        icon={History}
                        title="No backup runs yet"
                        description="Runs appear here once a schedule fires or a backup is triggered."
                    />
                ) : (
                    <ul className="divide-y divide-border rounded-lg border border-border">
                        {runs.map((run) => (
                            <RunRow
                                key={run.id}
                                run={run}
                                scheduleNames={scheduleNames}
                                isSettling={busyRunId === run.id}
                                onSettle={(runId) => void settle(runId)}
                                feedback={feedback.get(run.id)}
                            />
                        ))}
                    </ul>
                )}
            </Stack>
        </Card>
    );
}