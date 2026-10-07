'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';

import { Badge } from '@/components/core/Badge';
import { Button } from '@/components/core/Button';
import { Dialog } from '@/components/core/Dialog';
import { Input } from '@/components/core/Input';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';
// The leaf module, not the `@/lib/restore-apply` barrel: the barrel reaches
// `node:os` through the preview store and cannot be bundled for the browser.
import { conflictMessage, regenerateSuggestion } from '@/lib/restore-apply-conflicts';
import type { RestoreConflict } from '@/lib/restore-apply-conflicts';

/**
 * What the operator chose for one conflict.
 *
 * `merge-table` and `skip-table` are strategy changes: they are resolved by
 * changing the record this promote already sends, so they need no server write.
 * The rest rewrite the preview's scratch copy and are sent to the resolve action.
 */
export type ConflictChoice =
    | { readonly action: 'merge-table' }
    | { readonly action: 'skip-table' }
    | { readonly action: 'keep-live' }
    | { readonly action: 'take-archive' }
    | { readonly action: 'regenerate'; readonly column: string; readonly value: string };

export type ConflictAction = ConflictChoice['action'];

/**
 * The actions that fit the conflict.
 *
 * An overwrite-parent conflict is answered by changing what happens to the
 * tables, so its choices are the two strategy changes. A unique conflict is
 * answered on the archive rows, so its choices are the row-level ones. Only a
 * conflict on a single column offers to regenerate, because there is no one value
 * to replace when the uniqueness is spread across several.
 */
export function conflictActions(conflict: RestoreConflict): readonly ConflictAction[] {
    if (conflict.kind === 'fk-overwrite') return ['merge-table', 'skip-table'];
    return conflict.columns.length === 1 ? ['keep-live', 'take-archive', 'skip-table', 'regenerate'] : ['keep-live', 'take-archive', 'skip-table'];
}

/** The single column whose value a regenerate would replace, or null when the uniqueness is composite. */
export function regenerateColumn(conflict: RestoreConflict): string | null {
    if (conflict.kind === 'fk-overwrite' || conflict.columns.length !== 1) return null;
    return conflict.columns[0] ?? null;
}

const ACTION_LABEL: Readonly<Record<ConflictAction, string>> = {
    'merge-table': 'Merge it instead',
    'skip-table': 'Skip this table',
    'keep-live': 'Keep live',
    'take-archive': 'Take the archive',
    regenerate: 'Regenerate the value',
};

const ACTION_HINT: Readonly<Record<ConflictAction, string>> = {
    'merge-table': 'The table is merged rather than overwritten, which is what makes the reference safe.',
    'skip-table': 'The table is left out of this promote entirely; nothing in it is written.',
    'keep-live': 'Live keeps the value and the archive row that would carry it is dropped.',
    'take-archive': 'The archive row takes the live row key, so it overwrites that row instead of colliding.',
    regenerate: 'The archive row keeps its place under a new value, so live and the archive both survive.',
};

export interface RestoreConflictDialogProps {
    readonly conflict: RestoreConflict | null;
    /** What the archive row and the live row carry, filled in by the caller when it knows it. */
    readonly currentValue: string;
    readonly isBusy: boolean;
    readonly onChoose: (choice: ConflictChoice) => void;
    readonly onDismiss: () => void;
}

/**
 * One blocking conflict at a time, with only the actions that fit it.
 *
 * The prompt is deliberately singular: the operator answers this conflict, the
 * caller re-validates, and the next one is raised from a fresh report. Offering
 * the whole set at once would let a resolution be decided against a measurement
 * that a previous resolution had already invalidated.
 */
export function RestoreConflictDialog({
    conflict,
    currentValue,
    isBusy,
    onChoose,
    onDismiss,
}: RestoreConflictDialogProps): React.JSX.Element {
    const [regenerated, setRegenerated] = useState('');
    if (conflict === null) return <Dialog open={false} onOpenChange={onDismiss}>{null}</Dialog>;
    const actions = conflictActions(conflict);
    const column = regenerateColumn(conflict);
    const suggestion = column === null ? null : regenerateSuggestion(column, currentValue, () => crypto.randomUUID());
    const canRegenerate = actions.includes('regenerate') && suggestion !== null;
    return (
        <Dialog
            open
            pending={isBusy}
            title="Resolve a conflict before promoting"
            description={`"${conflict.table}" cannot be applied as it stands. Decide how to handle this one; the preview is measured again afterwards, so anything else it turns up is asked about next.`}
            footer={
                <Stack direction="row" gap={2} className="flex-wrap">
                    {actions.filter((action) => action !== 'regenerate').map((action) => (
                        <Button
                            key={action}
                            size="sm"
                            variant="secondary"
                            disabled={isBusy}
                            title={ACTION_HINT[action]}
                            onClick={() => onChoose({ action } as ConflictChoice)}
                        >
                            {ACTION_LABEL[action]}
                        </Button>
                    ))}
                    {canRegenerate && (
                        <Button
                            size="sm"
                            variant="positiveOutline"
                            disabled={isBusy}
                            title={ACTION_HINT.regenerate}
                            onClick={() => onChoose({ action: 'regenerate', column: column ?? '', value: regenerated || suggestion || '' })}
                        >
                            {ACTION_LABEL.regenerate}
                        </Button>
                    )}
                </Stack>
            }
            onOpenChange={(next) => { if (!next) onDismiss(); }}
        >
            <Stack gap={3}>
                <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-warning" />
                    <Badge variant={conflict.kind === 'fk-overwrite' ? 'warning' : 'destructive'}>{conflict.kind}</Badge>
                    <span className="text-sm text-white">{conflict.table}</span>
                </div>
                <Text variant="small" color="text-muted-foreground">{conflictMessage(conflict)}</Text>
                {canRegenerate && (
                    <Input
                        label={`New value for ${column}`}
                        value={regenerated}
                        placeholder={suggestion ?? ''}
                        disabled={isBusy}
                        onChange={(event) => setRegenerated(event.target.value)}
                    />
                )}
            </Stack>
        </Dialog>
    );
}
