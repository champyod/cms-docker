'use client';

import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';

import { Button } from '@/components/core/Button';
import { EmptyState } from '@/components/core/EmptyState';
import { ResponsiveTable, type ResponsiveColumn } from '@/components/core/ResponsiveTable';

interface RegistrySectionProps<Row> {
  readonly empty: string;
  readonly addLabel: string;
  readonly onAdd: () => void;
  readonly canAdd: boolean;
  readonly columns: readonly ResponsiveColumn<Row>[];
  readonly rows: readonly Row[];
  readonly getRowKey: (row: Row) => React.Key;
  readonly actionsHeader: string;
  readonly renderRowActions: (row: Row) => ReactNode;
}

/**
 * One collection of the registry, rendered through the shared list primitives.
 *
 * WHY no card and no heading: the board section around it owns both, so a second frame here would
 * read as a section inside a section. The add control stays with the rows because it opens this
 * table's own dialog, and the row type stays generic so every table keys on the record id rather
 * than a render index.
 */
export function RegistrySection<Row>({
  empty,
  addLabel,
  onAdd,
  canAdd,
  columns,
  rows,
  getRowKey,
  actionsHeader,
  renderRowActions,
}: RegistrySectionProps<Row>): React.JSX.Element {
  return (
    <div className="space-y-3">
      {canAdd && (
        <div className="flex justify-end">
          <Button size="sm" icon={Plus} onClick={onAdd}>{addLabel}</Button>
        </div>
      )}
      <ResponsiveTable
        columns={[...columns]}
        rows={[...rows]}
        getRowKey={(row) => getRowKey(row)}
        actionsHeader={actionsHeader}
        renderRowActions={(row) => renderRowActions(row)}
        emptyState={<EmptyState title={empty} />}
      />
    </div>
  );
}
