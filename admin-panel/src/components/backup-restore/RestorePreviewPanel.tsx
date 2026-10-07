'use client';

import { RefreshCw, ShieldCheck } from 'lucide-react';

import { Badge } from '@/components/core/Badge';
import { Button } from '@/components/core/Button';
import { Input } from '@/components/core/Input';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';
import { PROMOTE_PROGRESS_WINDOW_MS } from '@/components/backup-restore/useRestorePreview';
// Type-only: the runtime module reaches node:os through restore-preview-store and must stay out of the client bundle.
import type { PromoteReport, TableApplyRecord, TableApplyStatus, ValidateReport } from '@/lib/restore-apply';
import type { PromotePhase, PromoteProgressView } from '@/lib/restore-apply-progress';

const NO_BACKUP_ENTRY = 'none recorded';
const NOT_APPLIED = 'not applied';
const STATUS_VARIANT: Readonly<Record<TableApplyStatus, 'success' | 'destructive' | 'neutral' | 'warning'>> = {
    applied: 'success',
    failed: 'destructive',
    pending: 'warning',
    skipped: 'neutral',
};
const PHASE_TEXT: Readonly<Record<Exclude<PromotePhase, 'cleanup'>, string>> = {
    backup: 'Taking the pre-promote backup before any live row is written.',
    staging: 'Loading archive rows into the staging schema. Nothing live has changed yet.',
    applying: 'Committing one transaction per table, in foreign-key order.',
};
/** The cleanup phase drops staging whatever committed, so it may not claim a commit it does not have. */
const CLEANUP_TEXT: Readonly<Record<'every' | 'partial', string>> = {
    every: 'Every table is committed. Dropping the staging schema and reporting.',
    partial: 'Not every table is committed. Dropping the staging schema and reporting.',
};

/** A failed table rolled back, so it has no figures: zeros would read as an emptied table. */
function recordCounts(record: TableApplyRecord): string {
    if (record.liveBefore === null || record.liveAfter === null || record.merged === null) return NOT_APPLIED;
    return `${record.liveBefore} to ${record.liveAfter} live rows, ${record.merged} written`;
}

/**
 * The figure the applier publishes while a promote runs: one row per table, with
 * the tables already committed, the one in flight and those not reached yet.
 */
export function PromoteProgressList({ progress, onRecheck }: { readonly progress: PromoteProgressView; readonly onRecheck: () => void }) {
    if (progress.state === 'timeout') {
        return (
            <Stack gap={2} className="rounded-lg border border-border p-3">
                <Text variant="small" className="text-warning">
                    Stopped updating after {Math.round(PROMOTE_PROGRESS_WINDOW_MS / 60_000)} minutes. The promote was not touched and is still running on the server.
                </Text>
                <div>
                    <Button size="sm" variant="secondary" icon={RefreshCw} onClick={onRecheck}>Refresh</Button>
                </div>
            </Stack>
        );
    }
    if (progress.state !== 'running') return null;
    const pending = progress.totalTables - progress.doneTables.length - (progress.currentTable === null ? 0 : 1);
    const committed = progress.doneTables.length === progress.totalTables;
    const phase = progress.phase === 'cleanup' ? CLEANUP_TEXT[committed ? 'every' : 'partial'] : PHASE_TEXT[progress.phase];
    return (
        <Stack gap={2} className="rounded-lg border border-border p-3">
            <Text variant="small" color="text-muted-foreground">
                {`${phase} ${progress.doneTables.length} of ${progress.totalTables} table(s) committed.`}
            </Text>
            <ul className="divide-y divide-border rounded-lg border border-border">
                {progress.doneTables.map((table) => (
                    <li key={table} className="flex items-center gap-2 px-3 py-1.5">
                        <span className="text-sm text-white">{table}</span>
                        <Badge variant="success">committed</Badge>
                    </li>
                ))}
                {progress.currentTable !== null && (
                    <li className="flex items-center gap-2 px-3 py-1.5">
                        <span className="text-sm text-white">{progress.currentTable}</span>
                        <Badge variant="indigo">in progress</Badge>
                    </li>
                )}
                {pending > 0 && (
                    <li className="px-3 py-1.5">
                        <Text variant="small" color="text-muted-foreground">{`${pending} table(s) not reached yet. They are untouched unless a table below them fails.`}</Text>
                    </li>
                )}
            </ul>
        </Stack>
    );
}

/** What one promote committed, per table, plus what stayed pending when a table rolled back. */
export function PromoteRecords({ report }: { readonly report: PromoteReport }) {
    const pending = report.pendingTables;
    return (
        <Stack gap={3} className="rounded-lg border border-border p-3">
            <Text variant="small" className={report.ok ? 'text-success' : 'text-destructive'}>
                {report.ok
                    ? 'Every selected table applied and committed.'
                    : `The run stopped after ${report.appliedTables.length} committed table(s). Nothing that committed was rolled back, and no table after the failing one was attempted.`}
            </Text>
            <Text variant="small" color="text-muted-foreground">{`Backup manifest entry: ${report.backupEntry ?? NO_BACKUP_ENTRY}`}</Text>
            <ul className="divide-y divide-border rounded-lg border border-border">
                {report.tableRecords.map((record) => (
                    <li key={record.table} className="px-3 py-2">
                        <Stack gap={1}>
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm text-white">{record.table}</span>
                                <Badge variant={record.strategy === 'skip' ? 'neutral' : 'indigo'}>{record.strategy}</Badge>
                                <Badge variant={STATUS_VARIANT[record.status]}>{record.status}</Badge>
                                <span className="ml-auto text-xs text-muted-foreground">{recordCounts(record)}</span>
                            </div>
                            {record.note !== undefined && <Text variant="small" color="text-muted-foreground">{record.note}</Text>}
                        </Stack>
                    </li>
                ))}
            </ul>
            {pending.length > 0 && (
                <Text variant="small" className="text-warning">
                    {`Pending, never attempted in this run: ${pending.join(', ')}. Re-run and set those already applied to skip, which resumes exactly from here.`}
                </Text>
            )}
        </Stack>
    );
}

/**
 * The promote itself, once a measurement has passed.
 *
 * There is no separate validate button: a measurement is what the mode choice
 * runs, and every resolution runs it again, so the report on screen is always the
 * one the gate is bound to. Promote stays locked until that report passed and the
 * operator retyped the archive timestamp, because the server binds the other half
 * of the gate to the report id and refuses it once the live database has moved on
 * underneath the measurement.
 */
export function RestorePromoteGate({
    isBusy,
    isPromoting,
    validate,
    promote,
    progress,
    onRecheck,
    archiveName,
    confirmText,
    requiredPhrase,
    canPromote,
    onPromote,
    onConfirm,
}: {
    readonly isBusy: boolean;
    readonly isPromoting: boolean;
    readonly validate: ValidateReport | null;
    readonly promote: PromoteReport | null;
    readonly progress: PromoteProgressView;
    readonly onRecheck: () => void;
    readonly archiveName: string;
    readonly confirmText: string;
    readonly requiredPhrase: string;
    readonly canPromote: boolean;
    readonly onPromote: () => void;
    readonly onConfirm: (value: string) => void;
}) {
    return (
        <Stack gap={4}>
            <Stack direction="row" gap={3} className="flex-wrap items-center">
                <Button variant="negative" icon={ShieldCheck} loading={isPromoting} disabled={!canPromote} onClick={onPromote}>
                    Promote to live database
                </Button>
                {validate !== null && (
                    <Text variant="small" color="text-muted-foreground">
                        {validate.ok
                            ? `Validated ${validate.tableReports.length} table(s) at ${validate.generatedAt}.`
                            : validate.conflicts.length > 0
                                ? `${validate.conflicts.length} conflict(s) are still waiting for a decision.`
                                : 'Validation failed, so promote is locked until the selection or the archive change.'}
                    </Text>
                )}
            </Stack>
            {validate?.ok === true && (
                <Stack gap={2}>
                    <Text variant="small" color="text-muted-foreground">
                        {`Type the archive timestamp ${requiredPhrase} to bind this confirmation to ${archiveName}. The server binds the other half of the gate to validation report ${validate.reportId}, and refuses that report once it is 15 minutes old.`}
                    </Text>
                    <Input
                        label="Archive timestamp to confirm"
                        value={confirmText}
                        placeholder={requiredPhrase}
                        disabled={isBusy}
                        error={confirmText.trim() === requiredPhrase ? undefined : 'The typed text must match the archive timestamp exactly.'}
                        onChange={(event) => onConfirm(event.target.value)}
                    />
                </Stack>
            )}
            <PromoteProgressList progress={progress} onRecheck={onRecheck} />
            {promote !== null && <PromoteRecords report={promote} />}
        </Stack>
    );
}
