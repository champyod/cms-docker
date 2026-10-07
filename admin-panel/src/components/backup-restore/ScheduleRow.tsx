'use client';

import { Pencil, Power, PowerOff, Trash2 } from 'lucide-react';

import type { BackupSchedule } from '@/app/actions/schedules';
import { Badge } from '@/components/core/Badge';
import { Button } from '@/components/core/Button';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';
import type { BusyRow } from '@/components/backup-restore/useSchedules';

const SUMMARIZED_TABLE_COUNT = 4;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 1440;

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

function plural(count: number, unit: string): string {
    return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

function formatWhen(date: Date | null, fallback: string): string {
    return date === null ? fallback : date.toLocaleString();
}

interface ScheduleRowProps {
    readonly schedule: BackupSchedule;
    readonly busy: BusyRow | null;
    readonly onToggle: (schedule: BackupSchedule) => void;
    readonly onDelete: (schedule: BackupSchedule) => void;
    readonly onEdit: (schedule: BackupSchedule) => void;
}

export function ScheduleRow({ schedule, busy, onToggle, onDelete, onEdit }: ScheduleRowProps) {
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