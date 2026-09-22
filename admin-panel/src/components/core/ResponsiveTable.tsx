import React from 'react';

import { EmptyState } from '@/components/core/EmptyState';
import { MobileCard, MobileCardRow } from '@/components/core/MobileCard';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/core/Table';
import { cn } from '@/lib/utils';

// Why: one column definition drives both layouts, so callers stop
// hand-authoring desktop rows and mobile cards separately and the two
// views cannot drift apart.
export interface ResponsiveColumn<Row> {
  key: string;
  header: React.ReactNode;
  render: (row: Row) => React.ReactNode;
  mobileLabel?: string;
  hideOnMobile?: boolean;
}

export interface ResponsiveTableProps<Row> {
  columns: ResponsiveColumn<Row>[];
  rows: Row[];
  getRowKey: (row: Row, index: number) => React.Key;
  emptyState?: React.ReactNode;
  renderRowActions?: (row: Row, index: number) => React.ReactNode;
  actionsHeader?: React.ReactNode;
  getRowClassName?: (row: Row, index: number) => string | undefined;
  outerClassName?: string;
  className?: string;
}

function labelFor<Row>(column: ResponsiveColumn<Row>): string {
  if (column.mobileLabel) return column.mobileLabel;
  return typeof column.header === 'string' ? column.header : column.key;
}

function visibleOnMobile<Row>(columns: ResponsiveColumn<Row>[]): ResponsiveColumn<Row>[] {
  return columns.filter((column) => !column.hideOnMobile);
}

function renderMobileCards<Row>(props: ResponsiveTableProps<Row>): React.ReactNode {
  const { columns, rows, getRowKey, getRowClassName, renderRowActions } = props;
  const visible = visibleOnMobile(columns);
  return rows.map((row, index) => {
    const actions = renderRowActions?.(row, index);
    return (
      <MobileCard key={getRowKey(row, index)} className={getRowClassName?.(row, index)}>
        {visible.map((column) => (
          <MobileCardRow key={column.key} label={labelFor(column)} value={column.render(row)} />
        ))}
        {actions ? <div className="flex items-center justify-end gap-2 pt-2">{actions}</div> : null}
      </MobileCard>
    );
  });
}

function renderDesktopHeader<Row>(
  columns: ResponsiveColumn<Row>[],
  hasActions: boolean,
  actionsHeader: React.ReactNode,
): React.ReactNode {
  return (
    <TableHeader>
      <TableRow>
        {columns.map((column) => (
          <TableHead key={column.key}>{column.header}</TableHead>
        ))}
        {hasActions ? <TableHead className="text-right">{actionsHeader ?? 'Actions'}</TableHead> : null}
      </TableRow>
    </TableHeader>
  );
}

function renderDesktopRows<Row>(props: ResponsiveTableProps<Row>): React.ReactNode {
  const { columns, rows, getRowKey, getRowClassName, renderRowActions } = props;
  const hasActions = typeof renderRowActions === 'function';
  return (
    <TableBody>
      {rows.map((row, index) => (
        <TableRow key={getRowKey(row, index)} className={cn(getRowClassName?.(row, index))}>
          {columns.map((column) => (
            <TableCell key={column.key}>{column.render(row)}</TableCell>
          ))}
          {hasActions ? (
            <TableCell className="text-right">
              <div className="flex items-center justify-end gap-2">{renderRowActions?.(row, index)}</div>
            </TableCell>
          ) : null}
        </TableRow>
      ))}
    </TableBody>
  );
}

export function ResponsiveTable<Row>(props: ResponsiveTableProps<Row>): React.ReactElement {
  const { rows, columns, emptyState, renderRowActions, actionsHeader, outerClassName, className } = props;
  if (rows.length === 0) {
    return <>{emptyState ?? <EmptyState title="No data available" description="Table has no rows to display" />}</>;
  }
  // Why: delegate to Table's mobileCards switch instead of re-declaring
  // breakpoints, so a future breakpoint change stays in one place.
  return (
    <Table outerClassName={outerClassName} className={className} mobileCards={renderMobileCards(props)}>
      {renderDesktopHeader(columns, typeof renderRowActions === 'function', actionsHeader)}
      {renderDesktopRows(props)}
    </Table>
  );
}
