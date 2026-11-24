'use client';

import { useState } from 'react';
import { FileDown } from 'lucide-react';

import { Badge } from '@/components/core/Badge';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { Stack } from '@/components/core/Layout';
import type { ResponsiveColumn } from '@/components/core/ResponsiveTable';
import { Text } from '@/components/core/Typography';
import { BACKUP_TABLES, withRequiredTables } from '@/lib/backup-table-catalog';
import { withBasePath } from '@/lib/base-path';
import { SelectableGridTable } from '@/components/backup-restore/SelectableGridTable';
import type { BackupTable } from '@/lib/backup-table-catalog';

/** The endpoint the browser downloads from; the dump streams and nothing is kept server-side. */
export const EXPORT_URL = '/api/backups/export';

/** Names join with a comma and encode as one value, because the route splits on commas. */
export function exportUrl(tables: readonly string[]): string {
    return `${withBasePath(EXPORT_URL)}?tables=${encodeURIComponent(tables.join(','))}`;
}

const COLUMNS: readonly ResponsiveColumn<BackupTable>[] = [
    { key: 'label', header: 'Table', render: (row) => <span className="text-sm font-medium text-foreground">{row.label}</span> },
    { key: 'name', header: 'Name', render: (row) => <span className="font-mono text-xs text-muted-foreground">{row.name}</span> },
    {
        key: 'largeObjects',
        header: 'Large objects',
        render: (row) => (row.needsLargeObjects === true ? <Badge variant="warning">included</Badge> : null),
    },
];

/** The selection starts empty: the endpoint runs a real pg_dump against the live database. */
export function SaveToFileFlow(): React.JSX.Element {
    const [selection, setSelection] = useState<readonly string[]>([]);
    const [started, setStarted] = useState(false);
    const chosen = new Set(selection);

    const toggle = (name: string) => {
        setStarted(false);
        setSelection((previous) => {
            const toggled = previous.includes(name) ? previous.filter((entry) => entry !== name) : [...previous, name];
            // A table resolving into fsobjects brings fsobjects along, or the export restores rows it cannot resolve.
            return withRequiredTables(toggled);
        });
    };

    const save = () => {
        if (selection.length === 0) return;
        setStarted(true);
        // The route answers with Content-Disposition attachment, so it saves without navigating away.
        window.location.assign(exportUrl(selection));
    };
    return (
        <Card className="p-6">
            <Stack gap={6}>
                <Stack direction="row" align="center" gap={3}>
                    <div className="p-2 bg-emerald-500/10 rounded-lg"><FileDown className="w-5 h-5 text-emerald-400" /></div>
                    <Text variant="h2" className="mr-auto">Save Tables To A File</Text>
                </Stack>
                <Text variant="small" color="text-muted-foreground">
                    The selected tables are dumped to a pg_dump custom-format archive and streamed straight to this browser.
                    Nothing is written to the backup tree and the server keeps no copy, so the file you save is the only one.
                    The download can be uploaded back on the From File tab to restore it.
                </Text>
                {started && (
                    <Stack gap={3} role="status" aria-live="polite"
                        className="p-4 bg-emerald-500/10 rounded-xl border border-emerald-500/30">
                        <Text variant="label" className="text-emerald-300">
                            Preparing your download
                        </Text>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-emerald-500/20">
                            <div className="h-full w-1/3 animate-pulse rounded-full bg-emerald-400" />
                        </div>
                        <Text variant="small" className="text-emerald-200/90">
                            {`Dumping ${selection.length} table(s): ${selection.join(', ')}.`}
                        </Text>
                        <Text variant="small" className="text-emerald-200/90">
                            The server streams the archive as it produces it, so there is no size to report in
                            advance and no percentage to track: the bar only says the request is in flight.
                            Leaving this page ends the download, and because the server keeps no copy the dump
                            has to be started again.
                        </Text>
                    </Stack>
                )}
                <SelectableGridTable
                    rows={BACKUP_TABLES}
                    columns={COLUMNS}
                    getRowKey={(row) => row.name}
                    isSelected={(row) => chosen.has(row.name)}
                    onToggle={(row) => toggle(row.name)}
                />
                <Button
                    variant="positiveOutline"
                    icon={FileDown}
                    disabled={selection.length === 0}
                    onClick={save}
                >
                    {selection.length === 0 ? 'Select at least one table' : `Save ${selection.length} table(s) to a file`}
                </Button>
            </Stack>
        </Card>
    );
}
