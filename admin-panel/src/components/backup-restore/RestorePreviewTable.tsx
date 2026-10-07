'use client';

import { Eye } from 'lucide-react';

import { Badge } from '@/components/core/Badge';
import { Button } from '@/components/core/Button';
import { Stack } from '@/components/core/Layout';
import type { ResponsiveColumn } from '@/components/core/ResponsiveTable';
import { Text } from '@/components/core/Typography';
import { SelectableGridTable } from '@/components/backup-restore/SelectableGridTable';
// Type-only: the runtime module reaches node:os through restore-preview-store and must stay out of the client bundle.
import type { JsonValue, TableDiffRow } from '@/lib/restore-preview';

const NULL_CELL = 'NULL';
const JSON_INDENT = 2;

export interface SampleView {
    readonly table: string;
    readonly columns: readonly string[];
    readonly rows: readonly JsonValue[];
}

export interface RestorePreviewTableProps {
    readonly rows: readonly TableDiffRow[];
    /** The tables the operator picked; a table outside it is sent as skipped. */
    readonly selection: readonly string[];
    readonly sampleTable: string | null;
    readonly isSampleLoading: boolean;
    readonly sample: SampleView | null;
    readonly sampleError: string | null;
    readonly onToggle: (table: string) => void;
    readonly onViewSample: (table: string) => void;
}

function formatCell(value: JsonValue): string {
    if (value === null) return NULL_CELL;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value, null, JSON_INDENT);
}

export function describeRow(row: TableDiffRow): string {
    if (!row.archivePresent) return 'the archive carries no rows for this table';
    const updated = row.updatedEstimateMeasured ? `about ${row.updatedEstimate} updated` : 'updated rows not measured';
    return `${row.archiveRows} archive / ${row.liveRows} live rows, ${row.newEstimate} new, ${updated}`;
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

/**
 * The catalog tables the archive carries, as a row-click selection grid.
 *
 * One grid serves every list on this page, so a row is picked the same way here
 * as in the archive browser. A table the archive does not carry cannot be applied
 * at all, so it stays visible and reports why rather than disappearing from a list
 * the operator is comparing against the report.
 */
export function RestorePreviewTable({
    rows,
    selection,
    sampleTable,
    isSampleLoading,
    sample,
    sampleError,
    onToggle,
    onViewSample,
}: RestorePreviewTableProps) {
    const selected = new Set(selection);
    const columns: readonly ResponsiveColumn<TableDiffRow>[] = [
        { key: 'table', header: 'Table', render: (row) => <span className="text-sm font-medium text-white">{row.table}</span> },
        { key: 'presence', header: 'Archive', render: (row) => <Badge variant={row.archivePresent ? 'success' : 'neutral'}>{row.archivePresent ? 'in archive' : 'not in archive'}</Badge> },
        { key: 'rows', header: 'Archive versus live', render: (row) => <Text variant="small" color="text-muted-foreground">{describeRow(row)}</Text> },
        {
            key: 'sample',
            header: '',
            headerClassName: 'text-right',
            cellClassName: 'text-right',
            render: (row) => (
                <Button
                    size="sm"
                    variant="ghost"
                    icon={Eye}
                    disabled={!row.archivePresent}
                    loading={isSampleLoading && sampleTable === row.table}
                    // The row itself selects, so the sample action has to keep its own click to itself.
                    onClick={(event) => { event.stopPropagation(); onViewSample(row.table); }}
                >
                    Sample rows
                </Button>
            ),
        },
    ];
    return (
        <Stack gap={2}>
            <Text variant="small" color="text-muted-foreground">
                {`Click a table to include it in the restore. ${selection.length} of ${rows.length} selected. A table the archive does not carry cannot be applied and is not clickable.`}
            </Text>
            <SelectableGridTable
                rows={rows}
                columns={columns}
                getRowKey={(row) => row.table}
                isSelected={(row) => selected.has(row.table)}
                onToggle={(row) => onToggle(row.table)}
                isDisabled={(row) => !row.archivePresent}
            />
            <SampleViewer isSampleLoading={isSampleLoading} sample={sample} sampleError={sampleError} />
        </Stack>
    );
}
