'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Pencil, Plus, Power, PowerOff, RefreshCw, Trash2, X } from 'lucide-react';

import {
    createSchedule,
    deleteSchedule,
    listSchedules,
    toggleSchedule,
    updateSchedule,
} from '@/app/actions/schedules';
// Type-only: the runtime module reaches Prisma and must stay out of the client bundle.
import type { BackupSchedule, ScheduleMutationResult } from '@/app/actions/schedules';
import { Badge } from '@/components/core/Badge';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { EmptyState } from '@/components/core/EmptyState';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';
import { orderSelection, ScheduleForm, type FormValues } from '@/components/maintenance/ScheduleForm';
import { MAX_INTERVAL_MINS, MIN_INTERVAL_MINS, validateScheduleInput } from '@/lib/backup-schedules';

const DEFAULT_INTERVAL_MINS = 1440;
const SUMMARIZED_TABLE_COUNT = 4;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 1440;
const LIST_ERROR = 'Could not read the backup schedules.';
const SAVE_ERROR = 'Could not save the schedule.';

type Report = (notice: Notice | null) => void;

interface Notice {
    readonly tone: 'info' | 'error';
    readonly message: string;
}

type FormMode = { readonly kind: 'create' } | { readonly kind: 'edit'; readonly id: string } | null;

interface BusyRow {
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

function plural(count: number, unit: string): string {
    return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

export function formatInterval(intervalMins: number): string {
    if (intervalMins >= MINUTES_PER_DAY && intervalMins % MINUTES_PER_DAY === 0) {
        return `every ${plural(intervalMins / MINUTES_PER_DAY, 'day')}`;
    }
    if (intervalMins >= MINUTES_PER_HOUR && intervalMins % MINUTES_PER_HOUR === 0) {
        return `every ${plural(intervalMins / MINUTES_PER_HOUR, 'hour')}`;
    }
    return `every ${plural(intervalMins, 'min')}`;
}

/** A schedule or a run can name every catalog table, so a row shows the head of the list and a count. */
export function summarizeTables(tables: readonly string[]): string {
    const total = `${plural(tables.length, 'table')}: ${tables.slice(0, SUMMARIZED_TABLE_COUNT).join(', ')}`;
    const hidden = tables.length - SUMMARIZED_TABLE_COUNT;
    return hidden > 0 ? `${total} +${hidden} more` : total;
}

function formatWhen(date: Date | null, fallback: string): string {
    return date === null ? fallback : date.toLocaleString();
}

function parseInterval(raw: string): number {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) return parsed;
    return Math.min(Math.max(parsed, MIN_INTERVAL_MINS), MAX_INTERVAL_MINS);
}

function toFormValues(schedule: BackupSchedule): FormValues {
    return { name: schedule.name, interval: String(schedule.intervalMins), tables: schedule.tables };
}

function useScheduleList() {
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

function useScheduleMutations(reload: () => Promise<void>, report: Report) {
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

function useScheduleForm(reload: () => Promise<void>, report: Report) {
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

interface ScheduleRowProps {
    readonly schedule: BackupSchedule;
    readonly busy: BusyRow | null;
    readonly onToggle: (schedule: BackupSchedule) => void;
    readonly onDelete: (schedule: BackupSchedule) => void;
    readonly onEdit: (schedule: BackupSchedule) => void;
}

function ScheduleRow({ schedule, busy, onToggle, onDelete, onEdit }: ScheduleRowProps) {
    const isBusy = (action: BusyRow['action']) => busy?.id === schedule.id && busy.action === action;
    return (
        <Stack gap={2}>
            <Stack direction="row" align="center" gap={3} wrap>
                <div className="min-w-0 mr-auto">
                    <p className="text-sm font-medium text-white truncate">{schedule.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{summarizeTables(schedule.tables)}</p>
                </div>
                <Badge variant={schedule.enabled ? 'success' : 'neutral'}>
                    {schedule.enabled ? 'Enabled' : 'Disabled'}
                </Badge>
                <Badge variant="info">{formatInterval(schedule.intervalMins)}</Badge>
                <Button
                    size="sm"
                    variant="secondary"
                    icon={schedule.enabled ? PowerOff : Power}
                    loading={isBusy('toggle')}
                    onClick={() => void onToggle(schedule)}
                >
                    {schedule.enabled ? 'Disable' : 'Enable'}
                </Button>
                <Button size="sm" variant="secondary" icon={Pencil} disabled={busy !== null} onClick={() => onEdit(schedule)}>
                    Edit
                </Button>
                <Button
                    size="sm"
                    variant="negativeOutline"
                    icon={Trash2}
                    loading={isBusy('delete')}
                    onClick={() => void onDelete(schedule)}
                >
                    Delete
                </Button>
            </Stack>
            <Text variant="small" color="text-muted-foreground">
                Next run {formatWhen(schedule.nextRunAt, 'unknown')} &middot; last run {formatWhen(schedule.lastRunAt, 'never')}
            </Text>
        </Stack>
    );
}

export function ScheduleSection() {
    const [notice, setNotice] = useState<Notice | null>(null);
    const { schedules, isLoading, loadError, reload } = useScheduleList();
    const { busyRow, toggle, remove } = useScheduleMutations(reload, setNotice);
    const form = useScheduleForm(reload, setNotice);
    const editingId = form.mode?.kind === 'edit' ? form.mode.id : null;

    return (
        <Card className="p-6">
            <Stack gap={6}>
                <Stack direction="row" align="center" gap={3}>
                    <div className="p-2 bg-violet-500/10 rounded-lg">
                        <CalendarClock className="w-5 h-5 text-violet-400" />
                    </div>
                    <Text variant="h2" className="mr-auto">
                        Backup Schedules
                    </Text>
                    <Button size="sm" variant="secondary" icon={RefreshCw} loading={isLoading} onClick={() => void reload()}>
                        Refresh
                    </Button>
                    <Button
                        size="sm"
                        variant="positiveOutline"
                        icon={form.mode === null ? Plus : X}
                        onClick={() => (form.mode === null ? form.open({ kind: 'create' }) : form.open(null))}
                    >
                        {form.mode === null ? 'New schedule' : 'Close'}
                    </Button>
                </Stack>

                <Text variant="small" color="text-muted-foreground">
                    Recurring selective backups. The scheduler fires a due schedule in the background; the outcome
                    lands in the run history and on Discord.
                </Text>

                {loadError !== null ? (
                    <Text variant="small" role="alert" className="text-destructive">
                        {loadError}
                    </Text>
                ) : isLoading ? (
                    <Text variant="small" color="text-muted-foreground">
                        Loading schedules...
                    </Text>
                ) : schedules.length === 0 && form.mode === null ? (
                    <EmptyState
                        icon={CalendarClock}
                        title="No backup schedules yet"
                        description="Create a schedule to dump a fixed table selection on an interval."
                        actionLabel="New schedule"
                        onAction={() => form.open({ kind: 'create' })}
                    />
                ) : null}

                {form.mode?.kind === 'create' && (
                    <Stack gap={2} className="p-4 rounded-xl border border-border bg-muted/30">
                        <Text variant="label">New schedule</Text>
                        <ScheduleForm
                            values={form.values}
                            errors={form.errors}
                            warnings={form.warnings}
                            busy={form.isSubmitting}
                            submitLabel="Create schedule"
                            onChange={form.setValues}
                            onToggleTable={form.toggleTable}
                            onSubmit={() => void form.submit()}
                            onCancel={() => form.open(null)}
                        />
                    </Stack>
                )}

                {schedules.length > 0 && (
                    <ul className="divide-y divide-border rounded-lg border border-border">
                        {schedules.map((schedule) => (
                            <li key={schedule.id} className="px-3 py-3">
                                {editingId === schedule.id ? (
                                    <Stack gap={2}>
                                        <Text variant="label">Editing {schedule.name}</Text>
                                        <ScheduleForm
                                            values={form.values}
                                            errors={form.errors}
                                            warnings={form.warnings}
                                            busy={form.isSubmitting}
                                            submitLabel="Save changes"
                                            onChange={form.setValues}
                                            onToggleTable={form.toggleTable}
                                            onSubmit={() => void form.submit()}
                                            onCancel={() => form.open(null)}
                                        />
                                    </Stack>
                                ) : (
                                    <ScheduleRow
                                        schedule={schedule}
                                        busy={busyRow}
                                        onToggle={toggle}
                                        onDelete={remove}
                                        onEdit={(target) => form.open({ kind: 'edit', id: target.id }, toFormValues(target))}
                                    />
                                )}
                            </li>
                        ))}
                    </ul>
                )}

                {notice !== null && notice.message.length > 0 && (
                    <Text
                        variant="small"
                        role="status"
                        aria-live="polite"
                        className={notice.tone === 'error' ? 'text-destructive' : 'text-muted-foreground'}
                    >
                        {notice.message}
                    </Text>
                )}
            </Stack>
        </Card>
    );
}