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
  // Why: density lives on callers (e.g. `density:py-1` compact rows), so
  // columns carry their own cell class instead of the core imposing one.
  cellClassName?: string;
}

// Why: extra attributes (e.g. data-shortcut-row for j/k nav) must land
// on both layouts, so keyboard selection cannot die on migration.
export type ResponsiveRowProps = React.HTMLAttributes<HTMLElement> & {
  [dataAttribute: `data-${string}`]: string | number | undefined;
};

export interface ResponsiveTableProps<Row> {
  columns: ResponsiveColumn<Row>[];
  rows: Row[];
  getRowKey: (row: Row, index: number) => React.Key;
  getRowProps?: (row: Row, index: number) => ResponsiveRowProps | undefined;
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
  const { columns, rows, getRowKey, getRowClassName, getRowProps, renderRowActions } = props;
  const visible = visibleOnMobile(columns);
  return rows.map((row, index) => {
    const actions = renderRowActions?.(row, index);
    const extraProps = getRowProps?.(row, index);
    // Why: core-level null skip — a null/undefined column value means
    // "no data" (e.g. non-seeded group badge), so mobile omits the row
    // instead of rendering an empty label/value pair; desktop keeps the
    // empty cell to preserve column alignment.
    const cards = visible.flatMap((column) => {
      const value = column.render(row);
      if (value === null || value === undefined) return [];
      return <MobileCardRow key={column.key} label={labelFor(column)} value={value} />;
    });
    return (
      <MobileCard
        key={getRowKey(row, index)}
        {...extraProps}
        className={cn(getRowClassName?.(row, index), extraProps?.className)}
      >
        {cards}
        {actions ? <div className="flex items-center justify-end gap-1 pt-2">{actions}</div> : null}
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
  const { columns, rows, getRowKey, getRowClassName, getRowProps, renderRowActions } = props;
  const hasActions = typeof renderRowActions === 'function';
  return (
    <TableBody>
      {rows.map((row, index) => {
        const extraProps = getRowProps?.(row, index);
        return (
        <TableRow key={getRowKey(row, index)} {...extraProps} className={cn(getRowClassName?.(row, index), extraProps?.className)}>
          {columns.map((column) => (
            <TableCell key={column.key} className={column.cellClassName}>{column.render(row)}</TableCell>
          ))}
          {hasActions ? (
            <TableCell className="text-right">
              <div className="flex items-center justify-end gap-1">{renderRowActions?.(row, index)}</div>
            </TableCell>
          ) : null}
        </TableRow>
        );
      })}
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
