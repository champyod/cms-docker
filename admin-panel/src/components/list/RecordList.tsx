'use client';

import type { ReactNode } from 'react';

import {
  ResponsiveTable,
  type ResponsiveColumn,
  type ResponsiveRowProps,
} from '@/components/core/ResponsiveTable';
import { useAppRouter } from '@/hooks/useAppRouter';

export interface RecordListProps<Row> {
  readonly rows: readonly Row[];
  readonly columns: readonly ResponsiveColumn<Row>[];
  readonly getRowKey: (row: Row) => string | number;
  /** Canonical destination for the record; the only place a path is decided. */
  readonly getRecordHref: (row: Row) => string;
  readonly renderRowActions?: (row: Row) => ReactNode;
  readonly emptyState: ReactNode;
}

// Why every activation lives here: a desktop row and its mobile card are the
// same record, so the j/k attribute, the click target, and the Enter key must
// agree or keyboard users and pointer users reach different destinations.
function recordRowProps<Row>(
  row: Row,
  getRowKey: RecordListProps<Row>['getRowKey'],
  getRecordHref: RecordListProps<Row>['getRecordHref'],
  openRecord: (href: string) => void,
): ResponsiveRowProps {
  return {
    'data-shortcut-row': getRowKey(row),
    className: 'cursor-pointer',
    tabIndex: 0,
    onClick: () => openRecord(getRecordHref(row)),
    onKeyDown: (event) => {
      if (event.key === 'Enter' && event.target === event.currentTarget) openRecord(getRecordHref(row));
    },
  };
}

export function RecordList<Row>({
  rows,
  columns,
  getRowKey,
  getRecordHref,
  renderRowActions,
  emptyState,
}: RecordListProps<Row>): React.JSX.Element {
  const router = useAppRouter();
  const openRecord = (href: string): void => {
    router.push(href);
  };
  return (
    <ResponsiveTable
      columns={[...columns]}
      rows={[...rows]}
      getRowKey={getRowKey}
      getRowProps={(row) => recordRowProps(row, getRowKey, getRecordHref, openRecord)}
      renderRowActions={renderRowActions}
      emptyState={emptyState}
    />
  );
}
