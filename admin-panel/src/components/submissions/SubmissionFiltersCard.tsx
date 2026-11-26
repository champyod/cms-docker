'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, MoreHorizontal } from 'lucide-react';

import { getContests } from '@/app/actions/contests';
import { getTasks } from '@/app/actions/tasks';
import { Button } from '@/components/core/Button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/core/Command';
import { Dialog } from '@/components/core/Dialog';
import { TableToolbar } from '@/components/core/TableToolbar';
import { useDictionary } from '@/hooks/useDictionary';
import { apiClient, type ApiResponse } from '@/lib/apiClient';
import { cn } from '@/lib/utils';

/** The contest/task/user narrowing the list query supports, plus the free-text search. */
export interface SubmissionFilters {
  readonly contestId?: number;
  readonly taskId?: number;
  readonly userId?: number;
  /** Free text matching a submission id or the contestant's username. */
  readonly search?: string;
}

/** A positive integer, or undefined for blank and for anything that is not one. */
function readId(raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

const PICKER_DEBOUNCE_MS = 250;
const PICKER_PAGE_SIZE = 20;

interface PickerOption {
  readonly id: number;
  readonly name: string;
}

interface PickerUserRow {
  readonly id: number;
  readonly username: string | null;
}

async function loadContestOptions(query: string): Promise<readonly PickerOption[]> {
  const data = await getContests({ page: 1, search: query });
  return data.contests.map((contest) => ({ id: contest.id, name: contest.name }));
}

async function loadTaskOptions(query: string): Promise<readonly PickerOption[]> {
  const data = await getTasks({ page: 1, search: query });
  return data.tasks.slice(0, PICKER_PAGE_SIZE).map((task) => ({ id: task.id, name: task.name }));
}

async function loadUserOptions(query: string): Promise<readonly PickerOption[]> {
  const params = new URLSearchParams({ page: '1', perPage: String(PICKER_PAGE_SIZE), search: query });
  const result = await apiClient.get(`/api/users?${params.toString()}`);
  if (!result.success) throw new Error(result.error ?? '');
  const payload = result as ApiResponse & { readonly users?: readonly PickerUserRow[] };
  return (payload.users ?? []).map((user) => ({
    id: user.id,
    name: user.username ?? `#${user.id}`,
  }));
}

/**
 * The option list for an open picker, re-read after a short pause so a keystroke
 * does not become a query of its own. The readers are the same permission-gated
 * server actions the list pages use, so an unauthorized reader gets the server's
 * refusal here instead of an unguarded client-side query.
 */
function usePickerOptions(
  open: boolean,
  query: string,
  loadOptions: (query: string) => Promise<readonly PickerOption[]>,
  failedText: string,
): { readonly options: readonly PickerOption[]; readonly loading: boolean; readonly error: string | null } {
  const [options, setOptions] = useState<readonly PickerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let stale = false;
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      loadOptions(query.trim())
        .then((next) => {
          if (stale) return;
          setOptions(next);
          setLoading(false);
        })
        .catch((failure: unknown) => {
          if (stale) return;
          const message = failure instanceof Error ? failure.message : '';
          setOptions([]);
          setError(message === '' ? failedText : message);
          setLoading(false);
        });
    }, PICKER_DEBOUNCE_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [open, query, loadOptions, failedText]);

  return { options, loading, error };
}

type PickerKind = 'contest' | 'task' | 'user';

interface EntityPickerProps {
  readonly kind: PickerKind;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly loadOptions: (query: string) => Promise<readonly PickerOption[]>;
}

function pickerTriggerText(
  label: string,
  anyLabel: string,
  selectedId: number | undefined,
  picked: PickerOption | null,
): string {
  if (selectedId === undefined) return `${label} · ${anyLabel}`;
  if (picked !== null && picked.id === selectedId) return `${label} · ${picked.name}`;
  return `${label} · #${selectedId}`;
}

function pickerEmptyText(loading: boolean, error: string | null, searching: string, noMatches: string): string {
  if (error !== null) return error;
  return loading ? searching : noMatches;
}

/**
 * One narrowing field of the toolbar: a searchable Command picker over the
 * entity's reader, plus the hidden input that keeps the field's name in the
 * filter form. Selection only edits this field's value — the URL is pushed when
 * the toolbar submits, so every field still applies together and page resets.
 */
function EntityPicker({ kind, value, onChange, loadOptions }: EntityPickerProps): React.JSX.Element {
  const dict = useDictionary();
  const filters = dict.submissions.filters;
  const label = filters[kind];
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<PickerOption | null>(null);
  const selectedId = readId(value);
  const { options, loading, error } = usePickerOptions(open, query, loadOptions, filters.loadFailed);

  const choose = (option: PickerOption | null): void => {
    setPicked(option);
    onChange(option === null ? '' : String(option.id));
    setOpen(false);
  };

  return (
    <>
      <input type="text" hidden name={kind} value={value} onChange={(event) => onChange(event.target.value)} />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="w-full min-w-0 justify-between"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={label}
        onClick={() => setOpen(true)}
      >
        <span className="truncate">{pickerTriggerText(label, filters.any, selectedId, picked)}</span>
        <ChevronDown className="size-3.5 shrink-0 opacity-70" aria-hidden />
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title={label} description={filters.pickerHint}>
        <Command shouldFilter={false} className="border border-border">
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={`${filters.search} ${label.toLowerCase()}…`}
            aria-label={`${filters.search} ${label}`}
          />
          <CommandList>
            <CommandEmpty>{pickerEmptyText(loading, error, filters.searching, filters.noMatches)}</CommandEmpty>
            <CommandGroup heading={label}>
              {selectedId === undefined ? null : (
                <CommandItem value="picker-clear" onSelect={() => choose(null)}>
                  {filters.clear}
                </CommandItem>
              )}
              {options.map((option) => (
                <CommandItem
                  key={option.id}
                  value={`option-${option.id}`}
                  onSelect={() => choose(option)}
                >
                  <span className="truncate">{`${option.name} (#${option.id})`}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </Dialog>
    </>
  );
}

/**
 * The narrowing controls and the search, merged into the one toolbar the table
 * template defines: uniform 44px controls, an even picker grid, and below 768px
 * the pickers collapse behind a More toggle instead of wrapping into an orphan
 * line of right-aligned leftovers.
 *
 * WHY a form and not local state: the filter is a property of the view, not of the
 * component, so it belongs in the address bar — an operator can share or bookmark the
 * exact list they are looking at, and a reload keeps it. Every push resets the page,
 * because page 4 of the unfiltered list is not page 4 of a filtered one.
 */
export function SubmissionFiltersCard({
  filters,
  onApply,
}: {
  readonly filters: SubmissionFilters;
  readonly onApply: (next: SubmissionFilters) => void;
}): React.JSX.Element {
  const copy = useDictionary().submissions.filters;
  const [search, setSearch] = useState(filters.search ?? '');
  const [contest, setContest] = useState(filters.contestId === undefined ? '' : String(filters.contestId));
  const [task, setTask] = useState(filters.taskId === undefined ? '' : String(filters.taskId));
  const [user, setUser] = useState(filters.userId === undefined ? '' : String(filters.userId));
  const [moreOpen, setMoreOpen] = useState(false);

  const submit = (): void => {
    const term = search.trim();
    onApply({
      ...(term === '' ? {} : { search: term }),
      ...(readId(contest) === undefined ? {} : { contestId: readId(contest) }),
      ...(readId(task) === undefined ? {} : { taskId: readId(task) }),
      ...(readId(user) === undefined ? {} : { userId: readId(user) }),
    });
  };

  const clear = (): void => {
    setSearch('');
    setContest('');
    setTask('');
    setUser('');
    onApply({});
  };

  const hasAny = search !== '' || contest !== '' || task !== '' || user !== '';

  const rightContent = (
    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-1">
      <div
        className={cn(
          'w-full min-w-0 gap-2 md:w-auto md:flex-1 md:grid md:grid-cols-[repeat(auto-fit,minmax(150px,1fr))]',
          moreOpen ? 'grid grid-cols-1' : 'hidden',
        )}
      >
        <EntityPicker kind="contest" value={contest} onChange={setContest} loadOptions={loadContestOptions} />
        <EntityPicker kind="task" value={task} onChange={setTask} loadOptions={loadTaskOptions} />
        <EntityPicker kind="user" value={user} onChange={setUser} loadOptions={loadUserOptions} />
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={submit}>
          {copy.apply}
        </Button>
        {hasAny ? (
          <Button type="button" variant="ghost" size="sm" onClick={clear}>
            {copy.clear}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="md:hidden"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((open) => !open)}
        >
          <MoreHorizontal className="size-4" aria-hidden />
          {copy.more}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-2">
      <input
        type="text"
        hidden
        name="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <TableToolbar
        searchText={search}
        onSearchTextChange={setSearch}
        onSearchSubmit={submit}
        searchPlaceholder={copy.searchPlaceholder}
        rightContent={rightContent}
      />
    </div>
  );
}
