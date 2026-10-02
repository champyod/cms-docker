'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCheck, Eraser, Layers } from 'lucide-react';

import { triggerSelectiveBackup } from '@/app/actions/backups';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';
import { BACKUP_TABLES, validateTableSelection } from '@/lib/backup-table-catalog';
import type { BackupTable } from '@/lib/backup-table-catalog';

export interface BackupRunStatus {
    readonly tone: 'started' | 'error';
    readonly message: string;
}

export interface BackupSelectionSectionProps {
    readonly onBackupComplete: () => void;
}

function describeError(error: unknown, fallback: string): string {
    return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

interface TableRowProps {
    readonly table: BackupTable;
    readonly selected: boolean;
    readonly disabled: boolean;
    readonly onToggle: (name: string) => void;
}

function TableRow({ table, selected, disabled, onToggle }: TableRowProps) {
    return (
        <label className="flex items-center gap-2 rounded-md px-2 py-1 cursor-pointer hover:bg-muted/50">
            <input
                type="checkbox"
                checked={selected}
                disabled={disabled}
                onChange={() => onToggle(table.name)}
                className="size-4 accent-primary shrink-0"
            />
            <span className="text-sm text-white truncate">{table.label}</span>
            <span className="text-xs font-mono text-muted-foreground truncate">{table.name}</span>
            {table.needsLargeObjects === true && (
                <span
                    title="Rows reference large objects, so fsobjects must be in the same dump."
                    className="ml-auto text-[10px] font-bold uppercase tracking-widest text-amber-400 shrink-0"
                >
                    LO
                </span>
            )}
        </label>
    );
}

export function BackupSelectionSection({ onBackupComplete }: BackupSelectionSectionProps) {
    const [selected, setSelected] = useState<readonly string[]>([]);
    const [isRunning, setIsRunning] = useState(false);
    const [status, setStatus] = useState<BackupRunStatus | null>(null);

    const handleToggle = (name: string) => {
        setSelected((current) =>
            current.includes(name) ? current.filter((entry) => entry !== name) : [...current, name],
        );
    };

    // Catalog order is parent-before-child, so it is also the order the server hands to pg_dump.
    const orderedSelection = useMemo(
        () => BACKUP_TABLES.filter((table) => selected.includes(table.name)).map((table) => table.name),
        [selected],
    );
    const validation = useMemo(() => validateTableSelection(orderedSelection), [orderedSelection]);

    const handleTrigger = async () => {
        if (!validation.valid) {
            setStatus({ tone: 'error', message: validation.warnings[0] ?? 'Select at least one table.' });
            return;
        }
        const confirmed = confirm(
            `Trigger a selective backup of ${orderedSelection.length} table(s)?\n\n${orderedSelection.join(', ')}`,
        );
        if (!confirmed) return;

        setIsRunning(true);
        setStatus(null);
        try {
            const result = await triggerSelectiveBackup(orderedSelection);
            if (result.success) {
                setStatus({ tone: 'started', message: result.message ?? `Selective backup of ${orderedSelection.length} table(s) started in the background.` });
                onBackupComplete();
            } else {
                setStatus({ tone: 'error', message: result.error ?? 'Selective backup failed.' });
            }
        } catch (error) {
            setStatus({ tone: 'error', message: describeError(error, 'Selective backup failed.') });
        } finally {
            setIsRunning(false);
        }
    };

    return (
        <Card className="p-6">
            <Stack gap={6}>
                <Stack direction="row" align="center" gap={3}>
                    <div className="p-2 bg-amber-500/10 rounded-lg">
                        <Layers className="w-5 h-5 text-amber-400" />
                    </div>
                    <Text variant="h2">Selective Backup</Text>
                </Stack>

                <Text variant="small" color="text-muted-foreground">
                    Pick the tables to dump. Listed in restore order, parents first.
                </Text>

                <Stack direction="row" align="center" gap={3} wrap>
                    <Button
                        size="sm"
                        variant="secondary"
                        icon={CheckCheck}
                        disabled={isRunning}
                        onClick={() => setSelected(BACKUP_TABLES.map((table) => table.name))}
                    >
                        Select all
                    </Button>
                    <Button
                        size="sm"
                        variant="secondary"
                        icon={Eraser}
                        disabled={isRunning}
                        onClick={() => setSelected([])}
                    >
                        Clear
                    </Button>
                    <Text variant="small" color="text-muted-foreground" className="ml-auto">
                        {orderedSelection.length} of {BACKUP_TABLES.length} selected
                    </Text>
                </Stack>

                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-1 max-h-64 overflow-y-auto rounded-lg border border-border p-2">
                    {BACKUP_TABLES.map((table) => (
                        <TableRow
                            key={table.name}
                            table={table}
                            selected={selected.includes(table.name)}
                            disabled={isRunning}
                            onToggle={handleToggle}
                        />
                    ))}
                </div>

                {validation.warnings.length > 0 && (
                    <Stack gap={2} className="p-4 bg-amber-500/10 rounded-xl border border-amber-500/30">
                        <Stack direction="row" align="center" gap={2}>
                            <AlertTriangle className="w-4 h-4 text-amber-400" />
                            <Text variant="label" className="text-amber-400">
                                Restore warnings
                            </Text>
                        </Stack>
                        <ul className="text-xs text-amber-200/90 space-y-1 list-disc list-inside">
                            {validation.warnings.map((warning) => (
                                <li key={warning}>{warning}</li>
                            ))}
                        </ul>
                    </Stack>
                )}

                {status !== null && (
                    <Text
                        variant="small"
                        role="status"
                        aria-live="polite"
                        className={status.tone === 'started' ? 'text-amber-400' : 'text-destructive'}
                    >
                        {status.message}
                    </Text>
                )}

                <Button variant="positive" className="w-full" loading={isRunning} onClick={handleTrigger}>
                    Trigger Selective Backup
                </Button>
            </Stack>
        </Card>
    );
}
