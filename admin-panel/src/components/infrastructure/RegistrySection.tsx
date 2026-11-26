'use client';

import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';

import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { EmptyState } from '@/components/core/EmptyState';
import { ResponsiveTable, type ResponsiveColumn } from '@/components/core/ResponsiveTable';

interface RegistrySectionProps<Row> {
  readonly title: string;
  readonly count: number;
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
 * Why it takes a plain row array and a key function: the caller owns its record
 * type, so the section stays generic and every table keys on the record id rather
 * than a render index.
 */
export function RegistrySection<Row>({
  title,
  count,
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
    <Card className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-foreground">{title} ({count})</h2>
        {canAdd && <Button size="sm" icon={Plus} onClick={onAdd}>{addLabel}</Button>}
      </div>
      <ResponsiveTable
        columns={[...columns]}
        rows={[...rows]}
        getRowKey={(row) => getRowKey(row)}
        actionsHeader={actionsHeader}
        renderRowActions={(row) => renderRowActions(row)}
        emptyState={<EmptyState title={empty} />}
      />
    </Card>
  );
}
