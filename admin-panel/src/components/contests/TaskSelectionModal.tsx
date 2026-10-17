'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';

import { attachContestTasks } from '@/app/actions/contest-tasks';
import { Button } from '@/components/core/Button';
import { Dialog } from '@/components/core/Dialog';
import { SELECTION_CHECKBOX_CLASS } from '@/components/core/SelectionColumn';
import type { Dictionary } from '@/lib/dictionary';
import { interpolate } from '@/lib/interpolate';

interface AvailableTask {
  id: number;
  name: string;
  title: string;
}

interface TaskSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  contestId: number;
  availableTasks: AvailableTask[];
  onSuccess?: () => void;
  canCreateTask?: boolean;
  onRequestCreate?: () => void;
  copy: Dictionary['tasks']['contestTasks'];
}

/**
 * The one attach surface for a contest's tasks, and the bulk attach behind it.
 *
 * WHY it selects many and files once: the operator's day-2 setup attaches a term's worth of tasks
 * to a contest, and a modal that added one task per click was the manual work this replaces. The
 * selection goes to `attachContestTasks` — the same shared write the single-row add reaches — so
 * the next-number rule and the audit row are one implementation.
 *
 * WHY a refused attach is shown and not closed over: the write refuses the whole selection when any
 * named task is already on the contest, so the operator has to read which row stopped it rather
 * than lose it behind a modal that closes on a partial result.
 */
export function TaskSelectionModal({
  isOpen,
  onClose,
  contestId,
  availableTasks,
  onSuccess,
  canCreateTask = false,
  onRequestCreate,
  copy,
}: TaskSelectionModalProps): React.JSX.Element {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [attaching, setAttaching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Whitespace-only input means "no filter", matching the command-palette team search.
  const needle = search.trim().toLowerCase();
  const filteredTasks = useMemo(
    () =>
      availableTasks.filter(
        (task) => task.name.toLowerCase().includes(needle) || task.title.toLowerCase().includes(needle),
      ),
    [availableTasks, needle],
  );
  const allSelected = filteredTasks.length > 0 && filteredTasks.every((task) => selected.has(task.id));

  const toggle = (id: number, checked: boolean): void => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleAll = (checked: boolean): void => {
    setSelected((previous) => {
      const next = new Set(previous);
      for (const task of filteredTasks) {
        if (checked) next.add(task.id);
        else next.delete(task.id);
      }
      return next;
    });
  };

  const handleAttach = async (): Promise<void> => {
    setAttaching(true);
    setError(null);
    const result = await attachContestTasks(contestId, [...selected]);
    setAttaching(false);
    if (!result.success) {
      setError(result.error ?? copy.attachFailed);
      return;
    }
    setSelected(new Set());
    onSuccess?.();
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }} title={copy.attachTitle} className="sm:max-w-md">
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder={copy.filterPlaceholder}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="w-full rounded-lg border border-border bg-muted/50 py-2 pl-10 pr-4 text-sm text-foreground focus:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus:outline-none"
        />
      </div>

      <label className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
        <input
          type="checkbox"
          className={SELECTION_CHECKBOX_CLASS}
          checked={allSelected}
          aria-label={copy.selectAll}
          onChange={(event) => toggleAll(event.target.checked)}
        />
        {copy.selectAll}
      </label>

      <div className="max-h-64 space-y-2 overflow-y-auto">
        {filteredTasks.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{copy.attachEmpty}</p>
        ) : (
          filteredTasks.map((task) => (
            <label key={task.id} className="flex items-center justify-between gap-3 rounded-lg bg-muted/30 p-3 transition-colors hover:bg-muted/50">
              <span className="flex items-center gap-3">
                <input
                  type="checkbox"
                  className={SELECTION_CHECKBOX_CLASS}
                  checked={selected.has(task.id)}
                  aria-label={`${copy.selectRow} ${task.name}`}
                  onChange={(event) => toggle(task.id, event.target.checked)}
                />
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary">
                  {task.name.substring(0, 2).toUpperCase()}
                </span>
                <span>
                  <span className="block text-sm font-medium text-foreground">{task.name}</span>
                  <span className="block text-xs text-muted-foreground">{task.title}</span>
                </span>
              </span>
            </label>
          ))
        )}
      </div>

      {error !== null ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}

      <div className="mt-4 flex justify-end gap-3 border-t border-border pt-4">
        <Button variant="secondary" onClick={onClose} disabled={attaching}>{copy.attachCancel}</Button>
        <Button
          variant="positive"
          loading={attaching}
          disabled={attaching || selected.size === 0}
          onClick={() => { void handleAttach(); }}
        >
          {interpolate(copy.attachRun, { count: selected.size })}
        </Button>
      </div>

      {canCreateTask && onRequestCreate && (
        <div className="mt-4 border-t border-border pt-4">
          <Button variant="secondary" className="w-full" onClick={onRequestCreate}>{copy.createNew}</Button>
        </div>
      )}
    </Dialog>
  );
}
