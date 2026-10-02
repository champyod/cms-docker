'use client';

import { ShieldCheck } from 'lucide-react';

import { Badge } from '@/components/core/Badge';
import { Button } from '@/components/core/Button';
import { Input } from '@/components/core/Input';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';
// Type-only: the runtime module reaches node:os through restore-preview-store and must stay out of the client bundle.
import type { PromoteReport, TableApplyStatus, ValidateReport } from '@/lib/restore-apply';

const NO_BACKUP_ENTRY = 'none recorded';
const STATUS_VARIANT: Readonly<Record<TableApplyStatus, 'success' | 'destructive' | 'neutral' | 'warning'>> = {
    applied: 'success',
    failed: 'destructive',
    pending: 'warning',
    skipped: 'neutral',
};

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
