'use client';

import { useCallback, useEffect, useState } from 'react';
import { History, RefreshCw } from 'lucide-react';

import { listRuns, listSchedules } from '@/app/actions/schedules';
// Type-only: the runtime module reaches Prisma and must stay out of the client bundle.
import type { BackupRun } from '@/app/actions/schedules';
import { Badge } from '@/components/core/Badge';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { EmptyState } from '@/components/core/EmptyState';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';
import { RUN_STATUS_FAILED } from '@/scheduler/tick';
import { summarizeTables } from '@/components/maintenance/ScheduleSection';

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
};

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
}

function RunRow({ run, scheduleNames }: RunRowProps) {
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
                </Stack>
                <Text variant="small" color="text-muted-foreground">
                    Started {formatWhen(run.startedAt, 'unknown')} &middot; finished{' '}
                    {formatWhen(run.finishedAt, 'not finished')}
                </Text>
                {run.status === RUN_STATUS_FAILED && run.message !== null && (
                    <Text variant="small" className="text-destructive">
                        {run.message}
                    </Text>
                )}
            </Stack>
        </li>
    );
}

export function ScheduleRunsSection() {
    const { runs, scheduleNames, isLoading, loadError, reload } = useRunHistory();

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
                    finishes.
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
                            <RunRow key={run.id} run={run} scheduleNames={scheduleNames} />
                        ))}
                    </ul>
                )}
            </Stack>
        </Card>
    );
}