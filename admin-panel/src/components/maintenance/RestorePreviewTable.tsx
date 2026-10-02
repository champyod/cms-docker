'use client';

import { Eye } from 'lucide-react';

import { Badge } from '@/components/core/Badge';
import { Button } from '@/components/core/Button';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';
// Type-only: the runtime module reaches node:os through restore-preview-store and must stay out of the client bundle.
import type { JsonValue, TableDiffRow } from '@/lib/restore-preview';
import type { ApplyStrategies, TableStrategy } from '@/lib/restore-apply';

const NULL_CELL = 'NULL';
const JSON_INDENT = 2;
/** Mirrors TABLE_STRATEGIES in @/lib/restore-apply, which cannot be imported for value from a client component. */
const STRATEGY_OPTIONS: readonly { readonly value: TableStrategy; readonly label: string }[] = [
    { value: 'merge', label: 'Merge' },
    { value: 'overwrite', label: 'Overwrite' },
    { value: 'skip', label: 'Skip' },
];

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