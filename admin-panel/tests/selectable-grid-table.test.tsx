// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SelectableGridTable } from '@/components/backup-restore/SelectableGridTable';
import type { ResponsiveColumn } from '@/components/core/ResponsiveTable';

interface Row {
    readonly id: number;
    readonly name: string;
    /** A row the caller has said carries no choice, e.g. a table the archive does not hold. */
    readonly locked: boolean;
}

const COLUMNS: readonly ResponsiveColumn<Row>[] = [{ key: 'name', header: 'Name', render: (row) => row.name }];

const ROWS: readonly Row[] = [
    { id: 1, name: 'users', locked: false },
    { id: 2, name: 'audit_log', locked: true },
];

/** The desktop row is the traversable one, so the first match is the element under test. */
function rowFor(name: string): HTMLElement {
    return screen.getAllByText(name)[0]!;
}

function grid(): { readonly onToggle: ReturnType<typeof vi.fn> } {
    const onToggle = vi.fn();
    render(
        <SelectableGridTable
            rows={ROWS}
            columns={COLUMNS}
            getRowKey={(row) => row.id}
            isSelected={(row) => row.id === 1}
            onToggle={onToggle}
            isDisabled={(row) => row.locked}
        />,
    );
    return { onToggle };
}

afterEach(cleanup);

describe('SelectableGridTable', () => {
    it('selects a row that carries a choice', async () => {
        const { onToggle } = grid();
        await userEvent.click(rowFor('users'));
        expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('reports the selected row so the choice is visible', () => {
        grid();
        expect(rowFor('users').closest('[aria-selected="true"]')).not.toBeNull();
        expect(rowFor('audit_log').closest('[aria-selected="true"]')).toBeNull();
    });

    it('leaves a disabled row unselectable and says so', async () => {
        const { onToggle } = grid();
        const row = rowFor('audit_log');
        expect(row.closest('[aria-disabled="true"]')).not.toBeNull();
        await userEvent.click(row);
        expect(onToggle).not.toHaveBeenCalled();
    });

    it('keeps a disabled row out of the keyboard walk', () => {
        grid();
        expect(rowFor('audit_log').closest('[role="button"]')).toBeNull();
        expect(rowFor('users').closest('[role="button"]')).not.toBeNull();
    });
});
