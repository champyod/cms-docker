'use client';

import { ResponsiveTable } from '@/components/core/ResponsiveTable';
import type { ResponsiveColumn, ResponsiveRowProps } from '@/components/core/ResponsiveTable';
import { ROW_SELECTED_CLASSES } from '@/hooks/shortcut-rows';

export interface SelectableGridTableProps<Row> {
    readonly rows: readonly Row[];
    readonly columns: readonly ResponsiveColumn<Row>[];
    readonly getRowKey: (row: Row, index: number) => React.Key;
    readonly isSelected: (row: Row) => boolean;
    readonly onToggle: (row: Row) => void;
    /** A row that carries no choice: it stays visible but is not selectable and the keyboard skips it. */
    readonly isDisabled?: (row: Row) => boolean;
    readonly emptyState?: React.ReactNode;
    readonly className?: string;
}

/**
 * The one row-click selection grid behind every Backup & Restore list —
 * catalog tables and archive rows differ only in columns, never in how a row
 * is picked. One implementation keeps selection styling, keyboard activation
 * and the mobile-card fallback identical across those lists.
 */
export function SelectableGridTable<Row>({
    rows,
    columns,
    getRowKey,
    isSelected,
    onToggle,
    isDisabled,
    emptyState,
    className,
}: SelectableGridTableProps<Row>): React.JSX.Element {
    const getRowProps = (row: Row): ResponsiveRowProps => {
        // Why the whole interaction cluster goes: a disabled row that kept its
        // click handler would still select from a pointer, and one that kept
        // `role="button"` would still be announced as a control the reader can
        // press, so both are dropped together with the keyboard handler.
        if (isDisabled?.(row) === true) {
            return { 'aria-disabled': true, className: 'opacity-50 cursor-not-allowed' };
        }
        return {
            role: 'button',
            tabIndex: 0,
            'aria-selected': isSelected(row),
            className: isSelected(row) ? ROW_SELECTED_CLASSES.join(' ') : 'cursor-pointer',
            onClick: () => onToggle(row),
            onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onToggle(row);
                }
            },
        };
    };

    return (
        <ResponsiveTable
            columns={[...columns]}
            rows={[...rows]}
            getRowKey={getRowKey}
            getRowProps={getRowProps}
            emptyState={emptyState}
            className={className}
        />
    );
}
