'use client';

import { Eye, ShieldCheck } from 'lucide-react';

import { Badge } from '@/components/core/Badge';
import { Button } from '@/components/core/Button';
import { Input } from '@/components/core/Input';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';
// Type-only: both runtime modules reach node:os through restore-preview-store and must stay out of the client bundle.
import type { JsonValue, TableDiffRow } from '@/lib/restore-preview';
import type { ApplyStrategies, PromoteReport, TableApplyStatus, TableStrategy, ValidateReport } from '@/lib/restore-apply';

const NULL_CELL = 'NULL';
const JSON_INDENT = 2;
const NO_BACKUP_ENTRY = 'none recorded';
/** Mirrors TABLE_STRATEGIES in @/lib/restore-apply, which cannot be imported for value from a client component. */
const STRATEGY_OPTIONS: readonly { readonly value: TableStrategy; readonly label: string }[] = [
    { value: 'merge', label: 'Merge' },
    { value: 'overwrite', label: 'Overwrite' },
    { value: 'skip', label: 'Skip' },
];
const STATUS_VARIANT: Readonly<Record<TableApplyStatus, 'success' | 'destructive' | 'neutral' | 'warning'>> = {
    applied: 'success',
    failed: 'destructive',
    pending: 'warning',
    skipped: 'neutral',
};

export interface SampleView {
    readonly table: string;
    readonly columns: readonly string[];
    readonly rows: readonly JsonValue[];
}

export interface RestorePreviewTableProps {
    readonly rows: readonly TableDiffRow[];
    readonly strategies: ApplyStrategies;
    /** True while a validate or promote owns the run, so a strategy cannot change mid-flight. */
    readonly isLocked: boolean;
    readonly sampleTable: string | null;
    readonly isSampleLoading: boolean;
    readonly sample: SampleView | null;
    readonly sampleError: string | null;
    readonly onStrategyChange: (table: string, strategy: TableStrategy) => void;
    readonly onViewSample: (table: string) => void;
}

function formatCell(value: JsonValue): string {
    if (value === null) return NULL_CELL;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value, null, JSON_INDENT);
}

function describeRow(row: TableDiffRow): string {
    if (!row.archivePresent) return 'the archive carries no rows for this table';
    const updated = row.updatedEstimateMeasured ? `about ${row.updatedEstimate} updated` : 'updated rows not measured';
    return `${row.archiveRows} archive / ${row.liveRows} live rows, ${row.newEstimate} new, ${updated}`;
}

function StrategyPicker({ row, strategies, isLocked, onStrategyChange }: {
    readonly row: TableDiffRow;
    readonly strategies: ApplyStrategies;
    readonly isLocked: boolean;
    readonly onStrategyChange: (table: string, strategy: TableStrategy) => void;
}) {
    return (
        <fieldset className="flex flex-wrap items-center gap-3" disabled={isLocked}>
            <legend className="sr-only">{`Apply strategy for ${row.table}`}</legend>
            {STRATEGY_OPTIONS.map((option) => (
                <label key={option.value} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                        type="radio"
                        name={`strategy-${row.table}`}
                        value={option.value}
                        checked={strategies[row.table] === option.value}
                        onChange={() => onStrategyChange(row.table, option.value)}
                        className="accent-primary"
                    />
                    {option.label}
                </label>
            ))}
        </fieldset>
    );
}

function SampleViewer({ isSampleLoading, sample, sampleError }: {
    readonly isSampleLoading: boolean;
    readonly sample: SampleView | null;
    readonly sampleError: string | null;
}) {
    if (sampleError !== null) {
        return <Text variant="small" role="alert" className="text-destructive">{sampleError}</Text>;
    }
    if (isSampleLoading) {
        return <Text variant="small" role="status" aria-live="polite" color="text-muted-foreground">Reading sample rows from the scratch container...</Text>;
    }
    if (sample === null) return null;
    return (
        <div className="overflow-x-auto rounded-lg border border-border">
            <table className="min-w-full text-left text-xs">
                <caption className="px-3 py-2 text-left font-mono text-muted-foreground">{`First ${sample.rows.length} archived row(s) of ${sample.table}`}</caption>
                <thead className="bg-secondary/50">
                    <tr>{sample.columns.map((column) => <th key={column} scope="col" className="whitespace-nowrap px-3 py-1.5 font-semibold">{column}</th>)}</tr>
                </thead>
                <tbody>
                    {sample.rows.map((row, rowIndex) => (
                        <tr key={rowIndex} className="border-t border-border align-top">
                            {Array.isArray(row)
                                ? row.map((cell, cellIndex) => (
                                    <td key={sample.columns[cellIndex]} className="px-3 py-1.5 font-mono whitespace-pre-wrap break-words">{formatCell(cell)}</td>
                                ))
                                : <td colSpan={sample.columns.length} className="px-3 py-1.5 font-mono whitespace-pre-wrap break-words">{formatCell(row)}</td>}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
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
                                <span className="ml-auto text-xs text-muted-foreground">{`${record.liveBefore} to ${record.liveAfter} live rows, ${record.merged} written`}</span>
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
 * The two writes this panel can make, in order. Promote stays locked until a
 * validation passed and the operator retyped the archive timestamp, because the
 * server binds the other half of the gate to that report id and refuses it once
 * the live database has moved on underneath the measurement.
 */
export function RestorePromoteGate({
    isBusy,
    isValidating,
    isPromoting,
    validate,
    promote,
    archiveName,
    confirmText,
    requiredPhrase,
    canPromote,
    onValidate,
    onPromote,
    onConfirm,
}: {
    readonly isBusy: boolean;
    readonly isValidating: boolean;
    readonly isPromoting: boolean;
    readonly validate: ValidateReport | null;
    readonly promote: PromoteReport | null;
    readonly archiveName: string;
    readonly confirmText: string;
    readonly requiredPhrase: string;
    readonly canPromote: boolean;
    readonly onValidate: () => void;
    readonly onPromote: () => void;
    readonly onConfirm: (value: string) => void;
}) {
    return (
        <Stack gap={4}>
            <Stack direction="row" gap={3} className="flex-wrap items-center">
                <Button variant="secondary" icon={ShieldCheck} loading={isValidating} disabled={isBusy} onClick={onValidate}>
                    Validate before promoting
                </Button>
                <Button variant="negative" icon={ShieldCheck} loading={isPromoting} disabled={!canPromote} onClick={onPromote}>
                    Promote to live database
                </Button>
                {validate !== null && (
                    <Text variant="small" color="text-muted-foreground">
                        {validate.ok
                            ? `Validated ${validate.tableReports.length} table(s) at ${validate.generatedAt}.`
                            : 'Validation failed, so promote is locked until the strategies or the archive change.'}
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
            {promote !== null && <PromoteRecords report={promote} />}
        </Stack>
    );
}

export function RestorePreviewTable({
    rows,
    strategies,
    isLocked,
    sampleTable,
    isSampleLoading,
    sample,
    sampleError,
    onStrategyChange,
    onViewSample,
}: RestorePreviewTableProps) {
    return (
        <Stack gap={2}>
            <Text variant="small" color="text-muted-foreground">
                New rows come from the archive-versus-live row-count difference and updated rows from a primary-key sample
                projected onto the archive, so both are estimates. Merge is the default strategy.
            </Text>
            <ul className="divide-y divide-border rounded-lg border border-border">
                {rows.map((row) => (
                    <li key={row.table} className="px-3 py-3">
                        <Stack gap={2}>
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium text-white">{row.table}</span>
                                <Badge variant={row.archivePresent ? 'success' : 'neutral'}>{row.archivePresent ? 'in archive' : 'not in archive'}</Badge>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    icon={Eye}
                                    className="ml-auto"
                                    disabled={!row.archivePresent}
                                    loading={isSampleLoading && sampleTable === row.table}
                                    onClick={() => onViewSample(row.table)}
                                >
                                    Sample rows
                                </Button>
                            </div>
                            <Text variant="small" color="text-muted-foreground">{describeRow(row)}</Text>
                            <StrategyPicker row={row} strategies={strategies} isLocked={isLocked} onStrategyChange={onStrategyChange} />
                            {sampleTable === row.table && <SampleViewer isSampleLoading={isSampleLoading} sample={sample} sampleError={sampleError} />}
                        </Stack>
                    </li>
                ))}
            </ul>
        </Stack>
    );
}