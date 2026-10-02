'use client';

import { useState } from 'react';
import { CalendarClock, Plus, RefreshCw, X } from 'lucide-react';

// Type-only: the runtime module reaches Prisma and must stay out of the client bundle.
import type { BackupSchedule } from '@/app/actions/schedules';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { EmptyState } from '@/components/core/EmptyState';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';
import { ScheduleForm, type FormValues } from '@/components/maintenance/ScheduleForm';
import { ScheduleRow } from '@/components/maintenance/ScheduleRow';
import {
    useScheduleForm,
    useScheduleList,
    useScheduleMutations,
    type Notice,
} from '@/components/maintenance/useSchedules';

// ScheduleRunsSection imports summarizeTables from here; the re-export keeps that import path stable.
export { formatInterval, summarizeTables } from '@/components/maintenance/ScheduleRow';

function toFormValues(schedule: BackupSchedule): FormValues {
    return { name: schedule.name, interval: String(schedule.intervalMins), tables: schedule.tables };
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