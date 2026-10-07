'use client';

import { Copy, Replace } from 'lucide-react';

import { Button } from '@/components/core/Button';
import { Dialog } from '@/components/core/Dialog';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';
import type { RestoreMode } from '@/lib/restore-apply';

export interface RestoreModeDialogProps {
    readonly open: boolean;
    /** How many tables the choice covers, so the operator can see the scope it applies to. */
    readonly tableCount: number;
    readonly isBusy: boolean;
    readonly onChoose: (mode: RestoreMode) => void;
    readonly onDismiss: () => void;
}

/**
 * The one global choice the restore asks for: append or replace.
 *
 * It resolves the whole selection to one strategy, which is why it is asked once
 * rather than per table — the record the applier consumes is unchanged, every
 * table simply takes the same answer. A conflict that this choice cannot satisfy
 * is raised afterwards as its own prompt, so this dialog never has to explain the
 * consequences of a combination it cannot check yet.
 */
export function RestoreModeDialog({
    open,
    tableCount,
    isBusy,
    onChoose,
    onDismiss,
}: RestoreModeDialogProps): React.JSX.Element {
    return (
        <Dialog
            open={open}
            pending={isBusy}
            title="Apply Replace or Apply Append?"
            description={`This choice covers all ${tableCount} selected table(s).`}
            footer={
                <Stack direction="row" gap={2} className="flex-wrap">
                    <Button size="sm" variant="negativeOutline" icon={Replace} disabled={isBusy} onClick={() => onChoose('replace')}>
                        Apply Replace
                    </Button>
                    <Button size="sm" variant="positiveOutline" icon={Copy} disabled={isBusy} onClick={() => onChoose('append')}>
                        Apply Append
                    </Button>
                    <Button size="sm" variant="ghost" disabled={isBusy} onClick={onDismiss}>
                        Cancel
                    </Button>
                </Stack>
            }
            onOpenChange={(next) => { if (!next) onDismiss(); }}
        >
            <Stack gap={3}>
                <Text variant="small" color="text-muted-foreground">
                    <strong className="text-white">Apply Replace</strong> overwrites: a row the archive carries replaces the live row with the same key,
                    and a live row the archive does not carry is left alone.
                </Text>
                <Text variant="small" color="text-muted-foreground">
                    <strong className="text-white">Apply Append</strong> merges: a row the archive carries is inserted, and one whose key already exists
                    live is updated by the archive&apos;s values.
                </Text>
                <Text variant="small" color="text-muted-foreground">
                    Either way the preview is measured against the live database before anything is written, and a conflict is asked about one at a time.
                </Text>
            </Stack>
        </Dialog>
    );
}
