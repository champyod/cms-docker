'use client';

import { useCallback, useEffect, useState } from 'react';

import {
    createSchedule,
    deleteSchedule,
    listSchedules,
    settleRun,
    toggleSchedule,
    updateSchedule,
} from '@/app/actions/schedules';
// Type-only: the runtime module reaches Prisma and must stay out of the client bundle.
import type { BackupSchedule, ScheduleMutationResult } from '@/app/actions/schedules';
import { orderSelection, type FormValues } from '@/components/maintenance/ScheduleForm';
import { MAX_INTERVAL_MINS, MIN_INTERVAL_MINS, validateScheduleInput } from '@/lib/backup-schedules';

const DEFAULT_INTERVAL_MINS = 1440;
const LIST_ERROR = 'Could not read the backup schedules.';
const SAVE_ERROR = 'Could not save the schedule.';
const SETTLE_ERROR = 'Could not settle the backup run.';
const SETTLE_CONFIRM = 'Settle this backup run? It closes the row and lets its schedule fire again. Check Discord and backups/manifest.json for the real result first.';

export interface Notice {
    readonly tone: 'info' | 'error';
    readonly message: string;
}

export type Report = (notice: Notice | null) => void;

export type FormMode = { readonly kind: 'create' } | { readonly kind: 'edit'; readonly id: string } | null;

export interface BusyRow {
    readonly id: string;
    readonly action: 'toggle' | 'delete';
}

interface MutationMessages {
    readonly saved: (result: ScheduleMutationResult) => string;
    readonly failed: string;
}

const EMPTY_FORM: FormValues = {
    name: '',
    interval: String(DEFAULT_INTERVAL_MINS),
    tables: [],
};

function describeError(error: unknown, fallback: string): string {
    return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

function parseInterval(raw: string): number {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) return parsed;
    return Math.min(Math.max(parsed, MIN_INTERVAL_MINS), MAX_INTERVAL_MINS);
}

export function useScheduleList() {
    const [schedules, setSchedules] = useState<readonly BackupSchedule[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    const reload = useCallback(async () => {
        setIsLoading(true);
        setLoadError(null);
        try {
            const result = await listSchedules();
            if (!result.success) {
                setSchedules([]);
                setLoadError(result.error ?? LIST_ERROR);
                return;
            }
            setSchedules(result.schedules ?? []);
        } catch (error) {
            setSchedules([]);
            setLoadError(describeError(error, LIST_ERROR));
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        void reload();
    }, [reload]);

    return { schedules, isLoading, loadError, reload };
}

export function useScheduleMutations(reload: () => Promise<void>, report: Report) {
    const [busyRow, setBusyRow] = useState<BusyRow | null>(null);

    const runMutation = useCallback(
        async (action: () => Promise<ScheduleMutationResult>, messages: MutationMessages) => {
            try {
                const result = await action();
                if (!result.success) {
                    report({ tone: 'error', message: result.error ?? messages.failed });
                    return;
                }
                report({ tone: 'info', message: messages.saved(result) });
                await reload();
            } catch (error) {
                report({ tone: 'error', message: describeError(error, messages.failed) });
            }
        },
        [reload, report],
    );

    const toggle = useCallback(
        async (schedule: BackupSchedule) => {
            report(null);
            setBusyRow({ id: schedule.id, action: 'toggle' });
            await runMutation(() => toggleSchedule(schedule.id), {
                saved: (result) => `${result.schedule?.enabled === true ? 'Enabled' : 'Disabled'} ${schedule.name}.`,
                failed: `Could not toggle ${schedule.name}.`,
            });
            setBusyRow(null);
        },
        [runMutation, report],
    );

    const remove = useCallback(
        async (schedule: BackupSchedule) => {
            if (!confirm(`Delete schedule ${schedule.name}? It stops firing at once; its run history is kept.`)) return;
            report(null);
            setBusyRow({ id: schedule.id, action: 'delete' });
            await runMutation(() => deleteSchedule(schedule.id), {
                saved: (result) => result.message ?? `Deleted schedule ${schedule.name}.`,
                failed: `Could not delete ${schedule.name}.`,
            });
            setBusyRow(null);
        },
        [runMutation, report],
    );

    return { busyRow, toggle, remove };
}

/**
 * Settling a run is a per-row action, so its notice is keyed by run id and the
 * reload happens only after the row was actually settled.
 */
export function useSettleRun(reload: () => Promise<void>) {
    const [busyRunId, setBusyRunId] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<ReadonlyMap<string, Notice>>(new Map());

    const settle = useCallback(
        async (runId: string) => {
            if (!confirm(SETTLE_CONFIRM)) return;
            setBusyRunId(runId);
            const reportForRun = (notice: Notice): void =>
                setFeedback((current) => new Map(current).set(runId, notice));
            try {
                const result = await settleRun(runId);
                if (!result.success) {
                    reportForRun({ tone: 'error', message: result.error ?? SETTLE_ERROR });
                    return;
                }
                reportForRun({ tone: 'info', message: result.message ?? `Settled run ${runId}.` });
                await reload();
            } catch (error) {
                reportForRun({ tone: 'error', message: describeError(error, SETTLE_ERROR) });
            } finally {
                setBusyRunId(null);
            }
        },
        [reload],
    );

    return { busyRunId, feedback, settle };
}

export function useScheduleForm(reload: () => Promise<void>, report: Report) {
    const [mode, setMode] = useState<FormMode>(null);
    const [values, setValues] = useState<FormValues>(EMPTY_FORM);
    const [errors, setErrors] = useState<readonly string[]>([]);
    const [warnings, setWarnings] = useState<readonly string[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const open = useCallback((nextMode: FormMode, nextValues: FormValues = EMPTY_FORM) => {
        setMode(nextMode);
        setValues(nextValues);
        setErrors([]);
        setWarnings([]);
    }, []);

    const toggleTable = useCallback((tableName: string) => {
        setValues((current) => ({
            ...current,
            tables: current.tables.includes(tableName)
                ? current.tables.filter((entry) => entry !== tableName)
                : [...current.tables, tableName],
        }));
    }, []);

    const submit = useCallback(async () => {
        const validation = validateScheduleInput({
            name: values.name,
            tables: orderSelection(values.tables),
            intervalMins: parseInterval(values.interval),
        });
        const { schedule } = validation;
        if (mode === null || !validation.valid || schedule === null) {
            setErrors(validation.errors);
            return;
        }
        setErrors([]);
        setWarnings(validation.warnings);
        setIsSubmitting(true);
        const isCreate = mode.kind === 'create';
        try {
            const result = isCreate ? await createSchedule(schedule) : await updateSchedule(mode.id, schedule);
            if (!result.success) {
                setErrors([result.error ?? SAVE_ERROR]);
                return;
            }
            const savedName = result.schedule?.name ?? schedule.name;
            const summary = isCreate ? `Created schedule ${savedName}.` : `Updated schedule ${savedName}.`;
            const savedWarnings = result.warnings ?? [];
            const message = savedWarnings.length > 0 ? `${summary} ${savedWarnings.join(' ')}` : summary;
            report({ tone: 'info', message });
            open(null);
            await reload();
        } catch (error) {
            setErrors([describeError(error, SAVE_ERROR)]);
        } finally {
            setIsSubmitting(false);
        }
    }, [mode, open, reload, report, values]);

    return { mode, values, setValues, errors, warnings, isSubmitting, open, toggleTable, submit };
}