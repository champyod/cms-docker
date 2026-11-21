'use client';

import { useEffect, useRef } from 'react';

import type { ResponsiveColumn } from '@/components/core/ResponsiveTable';

export const SELECTION_CHECKBOX_CLASS = 'size-4 accent-primary cursor-pointer';

interface SelectAllCheckboxProps {
  readonly checked: boolean;
  readonly partlyChecked: boolean;
  readonly label: string;
  readonly onToggle: (checked: boolean) => void;
}

// Why a ref and not a prop: React does not model the checkbox's mixed state, so
// the indeterminate flag has to be written to the node itself.
function SelectAllCheckbox({ checked, partlyChecked, label, onToggle }: SelectAllCheckboxProps): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current !== null) ref.current.indeterminate = partlyChecked && !checked;
  }, [partlyChecked, checked]);

  return (
    <input
      ref={ref}
      type="checkbox"
      className={SELECTION_CHECKBOX_CLASS}
      aria-label={label}
      title={label}
      checked={checked}
      onChange={(event) => onToggle(event.target.checked)}
    />
  );
}

export interface SelectionColumnArgs<Row> {
  readonly getRowId: (row: Row) => number;
  readonly selectedIds: ReadonlySet<number>;
  readonly allSelected: boolean;
  readonly partlyChecked: boolean;
  readonly selectAllLabel: string;
  readonly selectRowLabel: (row: Row) => string;
  readonly onToggleAll: (checked: boolean) => void;
  readonly onToggleOne: (id: number, checked: boolean) => void;
}

/**
 * The select-all column every selectable list prepends, so the header box and
 * the row boxes cannot drift apart between tables.
 */
export function buildSelectionColumn<Row>(args: SelectionColumnArgs<Row>): ResponsiveColumn<Row> {
  const { getRowId, selectedIds, allSelected, partlyChecked, selectAllLabel, selectRowLabel, onToggleAll, onToggleOne } = args;
  return {
    key: 'select',
    header: (
      <SelectAllCheckbox checked={allSelected} partlyChecked={partlyChecked} label={selectAllLabel} onToggle={onToggleAll} />
    ),
    cellClassName: 'w-10',
    // Why the stop: the row is itself a navigation target, so the box must not
    // let its click bubble into opening the record.
    render: (row) => {
      const id = getRowId(row);
      return (
        <span onClick={(event) => event.stopPropagation()}>
          <input
            type="checkbox"
            className={SELECTION_CHECKBOX_CLASS}
            aria-label={selectRowLabel(row)}
            title={selectRowLabel(row)}
            checked={selectedIds.has(id)}
            onChange={(event) => onToggleOne(id, event.target.checked)}
          />
        </span>
      );
    },
    hideOnMobile: true,
  };
}
