'use client';

import { useMemo, useState } from 'react';

import { Button } from '@/components/core/Button';
import { cn } from '@/lib/utils';

/** One row the picker can offer: an id it stores and the label the operator reads. */
export interface TargetOption {
  readonly id: number;
  readonly label: string;
}

/** The labels the picker renders; passed in so one list serves every screen and locale. */
export interface TargetMultiSelectCopy {
  readonly searchPlaceholder: string;
  readonly selectAll: string;
  readonly clear: string;
  readonly empty: string;
  readonly noMatches: string;
}

export interface TargetMultiSelectProps {
  readonly options: readonly TargetOption[];
  readonly selectedIds: ReadonlySet<number>;
  readonly onToggle: (id: number, checked: boolean) => void;
  readonly onSelectAll: (checked: boolean) => void;
  readonly onClear: () => void;
  readonly copy: TargetMultiSelectCopy;
  /** Accessible name of the search box, e.g. "Search contests". */
  readonly label: string;
}

/**
 * The one checkbox list every multi-select in the panel is picked from.
 *
 * Why it exists: the task-assign dialog hand-rolled this list, and the apply-limits dialog needs
 * the same rows with a search box and select-all on top. Two copies would drift in look and in the
 * select-all/clear behaviour, so the list lives here once and both callers pass their options in.
 */
export function TargetMultiSelect({
  options,
  selectedIds,
  onToggle,
  onSelectAll,
  onClear,
  copy,
  label,
}: TargetMultiSelectProps): React.JSX.Element {
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const visible = useMemo(
    () => (query === '' ? options : options.filter((option) => option.label.toLowerCase().includes(query))),
    [options, query],
  );
  const allSelected = options.length > 0 && options.every((option) => selectedIds.has(option.id));
  const anySelected = selectedIds.size > 0;

  return (
    <div className="space-y-3">
      <input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={copy.searchPlaceholder}
        aria-label={label}
        className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />

      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm font-medium text-foreground">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={(event) => onSelectAll(event.target.checked)}
            className="size-4 accent-primary"
          />
          {copy.selectAll}
        </label>
        {anySelected && (
          <Button type="button" variant="ghost" onClick={onClear}>
            {copy.clear}
          </Button>
        )}
      </div>

      <div className="max-h-64 space-y-1 overflow-y-auto" data-target-list={label}>
        {visible.length === 0 ? (
          <p className="py-3 text-center text-sm text-muted-foreground">
            {options.length === 0 ? copy.empty : copy.noMatches}
          </p>
        ) : (
          visible.map((option) => {
            const active = selectedIds.has(option.id);
            return (
              <button
                key={option.id}
                type="button"
                role="checkbox"
                aria-checked={active}
                onClick={() => onToggle(option.id, !active)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                  active
                    ? 'border-ring/50 bg-primary/10 text-foreground'
                    : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted/50',
                )}
              >
                <span
                  className={cn(
                    'flex h-4 w-4 items-center justify-center rounded border',
                    active ? 'border-primary bg-primary' : 'border-muted-foreground/40',
                  )}
                >
                  {active && <span className="h-2 w-2 rounded-sm bg-card" />}
                </span>
                <span className="text-sm">{option.label}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
