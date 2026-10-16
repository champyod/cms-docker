'use client';

import { useMemo, useState } from 'react';
import { Ban } from 'lucide-react';

import { endRankingOverrides, type RankingOverride } from '@/app/actions/rankingOverrides';
import { Badge } from '@/components/core/Badge';
import { BulkActionBar } from '@/components/core/BulkActionBar';
import { Button } from '@/components/core/Button';
import { EmptyState } from '@/components/core/EmptyState';
import { SelectField } from '@/components/core/FormField';
import { Input } from '@/components/core/Input';
import { Stack } from '@/components/core/Layout';
import { ReasonDialog } from '@/components/core/ReasonDialog';
import { ResponsiveTable, type ResponsiveColumn } from '@/components/core/ResponsiveTable';
import { SELECTION_CHECKBOX_CLASS, buildSelectionColumn } from '@/components/core/SelectionColumn';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useListSelection, type ListSelection } from '@/hooks/useListSelection';
import { useReasonPrompt } from '@/hooks/useReasonPrompt';
import type { Dictionary } from '@/lib/dictionary';

type OverrideCopy = Dictionary['ranking']['overrides'];

const FILTER_NONE = '';
const ALL_KINDS: readonly string[] = ['user', 'team', 'ranking', 'task', 'contest'];
const ALL_ACTIONS: readonly string[] = ['hide', 'guest', 'pin', 'rename', 'score', 'freeze'];
const MUTED = 'text-muted-foreground';
const TARGET_CELL = 'max-w-[280px]';

interface Filters {
  readonly kind: string;
  readonly action: string;
  readonly orphanOnly: boolean;
  readonly term: string;
}

const NO_FILTERS: Filters = { kind: FILTER_NONE, action: FILTER_NONE, orphanOnly: false, term: '' };

function matchesFilters(row: RankingOverride, filters: Filters, orphans: readonly number[]): boolean {
  if (filters.kind !== FILTER_NONE && row.targetKind !== filters.kind) return false;
  if (filters.action !== FILTER_NONE && row.action !== filters.action) return false;
  if (filters.orphanOnly && !orphans.includes(row.contestId)) return false;
  if (filters.term === '') return true;
  const needle = filters.term.toLowerCase();
  return row.targetKey.toLowerCase().includes(needle) || row.reason.toLowerCase().includes(needle);
}

interface EnumFilterProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly choices: readonly string[];
  readonly allLabel: string;
  readonly onChange: (value: string) => void;
}

function EnumFilter({ id, label, value, choices, allLabel, onChange }: EnumFilterProps): React.JSX.Element {
  return (
    <SelectField id={id} label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value={FILTER_NONE}>{allLabel}</option>
      {choices.map((choice) => (
        <option key={choice} value={choice}>
          {choice}
        </option>
      ))}
    </SelectField>
  );
}

interface OrphanToggleProps {
  readonly checked: boolean;
  readonly label: string;
  readonly onChange: (checked: boolean) => void;
}

function OrphanToggle({ checked, label, onChange }: OrphanToggleProps): React.JSX.Element {
  return (
    <label className="flex items-center gap-2 pb-2 text-sm text-foreground">
      <input
        type="checkbox"
        className={SELECTION_CHECKBOX_CLASS}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

interface FilterBarProps {
  readonly copy: OverrideCopy;
  readonly filters: Filters;
  readonly onChange: (next: Filters) => void;
}

/** The list's filter half: the narrowing the ranking reader applies, plus the orphan switch. */
function OverrideFilterBar({ copy, filters, onChange }: FilterBarProps): React.JSX.Element {
  return (
    <Stack direction="row" gap={3} wrap align="end">
      <EnumFilter
        id="ranking-override-filter-kind"
        label={copy.filtersKind}
        value={filters.kind}
        choices={ALL_KINDS}
        allLabel={copy.filtersAll}
        onChange={(kind) => onChange({ ...filters, kind })}
      />
      <EnumFilter
        id="ranking-override-filter-action"
        label={copy.filtersAction}
        value={filters.action}
        choices={ALL_ACTIONS}
        allLabel={copy.filtersAll}
        onChange={(action) => onChange({ ...filters, action })}
      />
      <Input
        id="ranking-override-filter-search"
        label={copy.filtersSearch}
        value={filters.term}
        onChange={(event) => onChange({ ...filters, term: event.target.value })}
      />
      <OrphanToggle
        checked={filters.orphanOnly}
        label={copy.filtersOrphanOnly}
        onChange={(orphanOnly) => onChange({ ...filters, orphanOnly })}
      />
    </Stack>
  );
}

/** The count that says how much of what is listed no enabled binding serves. */
function OrphanNotice({ copy, count }: { readonly copy: OverrideCopy; readonly count: number }): React.JSX.Element | null {
  if (count === 0) return null;
  return (
    <p className="flex items-center gap-2 text-sm text-warning">
      <Badge variant="amber">{count}</Badge>
      {copy.orphanHint}
    </p>
  );
}

interface EndSelectedBarProps {
  readonly copy: OverrideCopy;
  readonly selection: ListSelection;
  readonly onEnd: (ids: readonly number[]) => void;
}

function EndSelectedBar({ copy, selection, onEnd }: EndSelectedBarProps): React.JSX.Element | null {
  if (selection.selectedCount === 0) return null;
  return (
    <BulkActionBar selectedCount={selection.selectedCount} onClear={selection.clear}>
      <Button variant="negative" size="sm" icon={Ban} onClick={() => onEnd([...selection.selectedIds])}>
        {copy.endSelected}
      </Button>
    </BulkActionBar>
  );
}

interface EndRequest {
  readonly copy: OverrideCopy;
  readonly selection: ListSelection;
  readonly reasonPrompt: ReturnType<typeof useReasonPrompt>;
  readonly router: ReturnType<typeof useAppRouter>;
  readonly ids: readonly number[];
}

/**
 * The one reasoned end behind both the row button and the bulk bar.
 *
 * WHY the reason is required and the failure is surfaced: ending an override is an audited state
 * change, so the operator has to say why, and a refused write has to read as a refusal rather
 * than as a batch that quietly stayed put.
 */
function askEnd({ copy, selection, reasonPrompt, router, ids }: EndRequest): void {
  reasonPrompt.ask({
    title: copy.endSelected,
    description: copy.orphanHint,
    submitLabel: copy.end,
    run: async (reason) => {
      try {
        await endRankingOverrides([...ids], reason);
        selection.clear();
        router.refresh();
        return { success: true, message: copy.endedSelected };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : copy.endFailed };
      }
    },
  });
}

function TargetCell({ row }: { readonly row: RankingOverride }): React.JSX.Element {
  return (
    <span className="block truncate" title={`${row.action} ${row.targetKind} ${row.targetKey}`}>
      <span className="font-mono text-muted-foreground">{row.id}</span> <span>{`${row.action} ${row.targetKind}`}</span>{' '}
      <span className="font-mono">{row.targetKey}</span>
    </span>
  );
}

function ContestCell({
  row,
  copy,
  orphanContestIds,
}: {
  readonly row: RankingOverride;
  readonly copy: OverrideCopy;
  readonly orphanContestIds: readonly number[];
}): React.JSX.Element {
  return (
    <span className="flex items-center gap-2">
      <span className={MUTED}>{row.contestId}</span>
      {orphanContestIds.includes(row.contestId) ? <Badge variant="amber">{copy.orphanBadge}</Badge> : null}
    </span>
  );
}

/**
 * WHY the table and not a bespoke list: the panel already renders every list through one
 * responsive table, and a second copy would drift from the selection, the empty state and the
 * mobile card the rest of the panel already agrees on.
 */
function buildOverrideColumns(
  copy: OverrideCopy,
  selection: ListSelection,
  orphanContestIds: readonly number[],
): ResponsiveColumn<RankingOverride>[] {
  return [
    buildSelectionColumn<RankingOverride>({
      getRowId: (row) => Number(row.id),
      selectedIds: selection.selectedIds,
      allSelected: selection.allSelected,
      partlyChecked: selection.someSelected,
      selectAllLabel: copy.selectAll,
      selectRowLabel: () => copy.selectRow,
      onToggleAll: selection.toggleAll,
      onToggleOne: selection.toggleOne,
    }),
    { key: 'target', header: copy.target, cellClassName: TARGET_CELL, render: (row) => <TargetCell row={row} /> },
    {
      key: 'contest',
      header: copy.columnContest,
      render: (row) => <ContestCell row={row} copy={copy} orphanContestIds={orphanContestIds} />,
    },
    { key: 'reason', header: copy.columnReason, render: (row) => <span className={MUTED}>{row.reason}</span> },
    { key: 'created', header: copy.columnCreated, render: (row) => <span className={MUTED}>{row.createdAt}</span> },
  ];
}

interface OverrideTableProps {
  readonly copy: OverrideCopy;
  readonly columns: ResponsiveColumn<RankingOverride>[];
  readonly rows: readonly RankingOverride[];
  readonly canOverride: boolean;
  readonly onEnd: (ids: readonly number[]) => void;
}

function OverrideTable({ copy, columns, rows, canOverride, onEnd }: OverrideTableProps): React.JSX.Element {
  return (
    <ResponsiveTable
      columns={columns}
      rows={[...rows]}
      getRowKey={(row) => row.id}
      emptyState={<EmptyState title={copy.listEmpty} />}
      renderRowActions={
        canOverride
          ? (row) => (
              <Button variant="negativeOutline" size="sm" onClick={() => onEnd([Number(row.id)])}>
                {copy.end}
              </Button>
            )
          : undefined
      }
      actionsHeader={copy.columnAction}
    />
  );
}

export interface RankingOverrideListProps {
  readonly copy: OverrideCopy;
  readonly rows: readonly RankingOverride[];
  readonly orphanContestIds: readonly number[];
  readonly canOverride: boolean;
}

/**
 * The override list: filters over the live rows, a selection, and one reasoned end for the batch.
 *
 * WHY the orphan badge lives here and not on the ranking: the ranker filters its rows by its own
 * scope, so a row filed under a contest it does not serve stops applying with no error at all.
 * The panel is the only place that reads both the registry bindings and the rows, so it is the
 * only place the dead row can be named.
 */
export function RankingOverrideList({
  copy,
  rows,
  orphanContestIds,
  canOverride,
}: RankingOverrideListProps): React.JSX.Element {
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const selection = useListSelection('ranking.overrides', rows.map((row) => Number(row.id)));
  const reasonPrompt = useReasonPrompt();
  const router = useAppRouter();
  const filtered = useMemo(
    () => rows.filter((row) => matchesFilters(row, filters, orphanContestIds)),
    [rows, filters, orphanContestIds],
  );
  const columns = useMemo(
    () => buildOverrideColumns(copy, selection, orphanContestIds),
    [copy, selection, orphanContestIds],
  );
  const orphanCount = filtered.filter((row) => orphanContestIds.includes(row.contestId)).length;
  const onEnd = (ids: readonly number[]): void => askEnd({ copy, selection, reasonPrompt, router, ids });

  return (
    <Stack gap={4}>
      <OverrideFilterBar copy={copy} filters={filters} onChange={setFilters} />
      <OrphanNotice copy={copy} count={orphanCount} />
      {canOverride ? <EndSelectedBar copy={copy} selection={selection} onEnd={onEnd} /> : null}
      <OverrideTable copy={copy} columns={columns} rows={filtered} canOverride={canOverride} onEnd={onEnd} />
      <ReasonDialog request={reasonPrompt.request} onClose={reasonPrompt.close} onSubmit={reasonPrompt.submit} />
      {reasonPrompt.feedback !== null ? <p className="text-sm text-success">{reasonPrompt.feedback}</p> : null}
    </Stack>
  );
}
