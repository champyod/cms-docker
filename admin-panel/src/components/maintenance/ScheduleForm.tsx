'use client';

import { Button } from '@/components/core/Button';
import { Input } from '@/components/core/Input';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';
import { BACKUP_TABLES } from '@/lib/backup-table-catalog';
import { MAX_INTERVAL_MINS, MAX_NAME_LENGTH, MIN_INTERVAL_MINS } from '@/lib/backup-schedules';

export interface FormValues {
    readonly name: string;
    readonly interval: string;
    readonly tables: readonly string[];
}

/** Catalog order is parent-before-child, so the form submits the order pg_dump is handed. */
export function orderSelection(tables: readonly string[]): string[] {
    return BACKUP_TABLES.filter((table) => tables.includes(table.name)).map((table) => table.name);
}

interface TableChecklistProps {
    readonly selected: readonly string[];
    readonly disabled: boolean;
    readonly onToggle: (name: string) => void;
}

function TableChecklist({ selected, disabled, onToggle }: TableChecklistProps) {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-1 max-h-48 overflow-y-auto rounded-lg border border-border p-2">
            {BACKUP_TABLES.map((table) => (
                <label
                    key={table.name}
                    className="flex items-center gap-2 rounded-md px-2 py-1 cursor-pointer hover:bg-muted/50"
                >
                    <input
                        type="checkbox"
                        checked={selected.includes(table.name)}
                        disabled={disabled}
                        onChange={() => onToggle(table.name)}
                        className="size-4 accent-primary shrink-0"
                    />
                    <span className="text-sm text-white truncate">{table.label}</span>
                    <span className="text-xs font-mono text-muted-foreground truncate">{table.name}</span>
                </label>
            ))}
        </div>
    );
}

interface ScheduleFormProps {
    readonly values: FormValues;
    readonly errors: readonly string[];
    readonly warnings: readonly string[];
    readonly busy: boolean;
    readonly submitLabel: string;
    readonly onChange: (values: FormValues) => void;
    readonly onToggleTable: (name: string) => void;
    readonly onSubmit: () => void;
    readonly onCancel: () => void;
}

export function ScheduleForm(props: ScheduleFormProps) {
    const { values, errors, warnings, busy, submitLabel, onChange, onToggleTable, onSubmit, onCancel } = props;
    const selected = orderSelection(values.tables);
    return (
        <Stack gap={3}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                    label="Schedule name"
                    value={values.name}
                    disabled={busy}
                    maxLength={MAX_NAME_LENGTH}
                    onChange={(event) => onChange({ ...values, name: event.target.value })}
                />
                <Input
                    label="Interval (minutes)"
                    type="number"
                    value={values.interval}
                    disabled={busy}
                    min={MIN_INTERVAL_MINS}
                    max={MAX_INTERVAL_MINS}
                    onChange={(event) => onChange({ ...values, interval: event.target.value })}
                />
            </div>

            <TableChecklist selected={selected} disabled={busy} onToggle={onToggleTable} />

            <Text variant="small" color="text-muted-foreground">
                {selected.length} of {BACKUP_TABLES.length} selected &middot; every {MIN_INTERVAL_MINS} to{' '}
                {MAX_INTERVAL_MINS} minutes
            </Text>

            {warnings.length > 0 && (
                <ul className="text-xs text-amber-200/90 space-y-1 list-disc list-inside">
                    {warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                    ))}
                </ul>
            )}

            {errors.length > 0 && (
                <Text variant="small" role="alert" className="text-destructive">
                    {errors.join(' ')}
                </Text>
            )}

            <Stack direction="row" gap={3} justify="end">
                <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
                    Cancel
                </Button>
                <Button size="sm" variant="positive" loading={busy} onClick={onSubmit}>
                    {submitLabel}
                </Button>
            </Stack>
        </Stack>
    );
}