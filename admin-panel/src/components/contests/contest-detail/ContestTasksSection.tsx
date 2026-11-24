'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ClipboardList, Plus, Trash2, Settings } from 'lucide-react';

import { detachContestTasks } from '@/app/actions/contest-tasks';
import { BulkActionBar } from '@/components/core/BulkActionBar';
import { Button } from '@/components/core/Button';
import { EmptyState } from '@/components/core/EmptyState';
import { Input } from '@/components/core/Input';
import { SELECTION_CHECKBOX_CLASS } from '@/components/core/SelectionColumn';
import { useListSelection } from '@/hooks/useListSelection';
import type { Dictionary } from '@/lib/dictionary';
import { interpolate } from '@/lib/interpolate';
import { hasEffectivePermission } from '@/lib/permission-engine';
import { buildRoute } from '@/lib/navigation/routes';

interface Task { id: number; name: string; title: string; }

interface Props {
  contestId: number;
  tasks: Task[];
  locale: string;
  permissionKeys: readonly string[];
  copy: Dictionary;
  onAddTask: () => void;
  onAttachTasks: () => void;
  onRemoveTask: (id: number) => void;
  onRefresh: () => void;
}

// Assignment is a write action, so readers without task:update never see a dead Add or Remove.
function useCanManageTasks(permissionKeys: readonly string[]): boolean {
  return hasEffectivePermission(new Set(permissionKeys), 'task:update');
}

function matchesTerm(task: Task, needle: string): boolean {
  if (needle === '') return true;
  return task.name.toLowerCase().includes(needle) || task.title.toLowerCase().includes(needle);
}

function TaskRow({
  task,
  locale,
  canManage,
  selected,
  onToggle,
  onRemoveTask,
}: {
  readonly task: Task;
  readonly locale: string;
  readonly canManage: boolean;
  readonly selected: boolean;
  readonly onToggle: (id: number, checked: boolean) => void;
  readonly onRemoveTask: (id: number) => void;
}): React.JSX.Element {
  return (
    <div className="group flex items-center justify-between p-4 transition-colors hover:bg-muted/50">
      <div className="flex items-center gap-3">
        {canManage && (
          <input
            type="checkbox"
            className={SELECTION_CHECKBOX_CLASS}
            checked={selected}
            aria-label={`${task.name}`}
            onChange={(event) => onToggle(task.id, event.target.checked)}
          />
        )}
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-warning/10 text-sm font-bold text-warning">{task.name.substring(0, 2).toUpperCase()}</div>
        <div>
          <div className="font-medium text-foreground">{task.name}</div>
          <div className="text-xs text-muted-foreground">{task.title}</div>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Link
          href={buildRoute(locale, 'tasks.tabs.overview', { id: task.id })}
          aria-label={`Open ${task.name}`}
          prefetch
          className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-primary"
        >
          <Settings aria-hidden className="h-4 w-4" />
        </Link>
        {canManage && (
          <Button variant="ghost" iconOnly icon={Trash2} tooltip="Remove" aria-label={`Remove ${task.name}`} onClick={() => onRemoveTask(task.id)} className="shrink-0 rounded-lg hover:text-destructive" />
        )}
      </div>
    </div>
  );
}

/** The select-all walks the filtered set, and the detach reports which named task stopped the whole write. */
export function ContestTasksSection({
  contestId,
  tasks,
  locale,
  permissionKeys,
  copy,
  onAddTask,
  onAttachTasks,
  onRemoveTask,
  onRefresh,
}: Props): React.JSX.Element {
  const canManage = useCanManageTasks(permissionKeys);
  const strings = copy.tasks.contestTasks;
  const [term, setTerm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const needle = term.trim().toLowerCase();
  const filtered = useMemo(() => tasks.filter((task) => matchesTerm(task, needle)), [tasks, needle]);
  const filteredIds = useMemo(() => filtered.map((task) => task.id), [filtered]);
  const selection = useListSelection('contest.tasks', filteredIds);

  const handleDetach = async (): Promise<void> => {
    const ids = [...selection.selectedIds];
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await detachContestTasks(contestId, ids);
    setBusy(false);
    if (!result.success) {
      setError(result.error ?? strings.failed);
      return;
    }
    selection.clear();
    const changed = result.changed ?? 0;
    setMessage(
      changed < ids.length
        ? interpolate(strings.detachPartial, { count: changed, total: ids.length })
        : interpolate(strings.detachDone, { count: changed }),
    );
    onRefresh();
  };

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 border-b border-border bg-muted/20 p-4">
        {canManage && (
          <label className="flex items-center gap-2 pb-2 text-sm text-foreground">
            <input
              type="checkbox"
              className={SELECTION_CHECKBOX_CLASS}
              aria-label={strings.selectAll}
              title={strings.selectAll}
              checked={selection.allSelected}
              onChange={(event) => selection.toggleAll(event.target.checked)}
            />
            {strings.selectAll}
          </label>
        )}
        <Input
          id="contest-task-filter"
          label={strings.filterPlaceholder}
          value={term}
          onChange={(event) => setTerm(event.target.value)}
        />
        {canManage && (
          <div className="ml-auto flex items-center gap-2">
            <Button variant="positiveOutline" size="sm" icon={Plus} onClick={onAddTask}>Add Task</Button>
          </div>
        )}
      </div>

      {canManage ? (
        <div className="space-y-2 px-4 pt-4">
          <BulkActionBar
            selectedCount={selection.selectedCount}
            countLabel={copy.states.selection.count}
            clearLabel={copy.states.selection.clear}
            onClear={selection.clear}
          >
            <Button variant="secondary" size="sm" onClick={onAttachTasks}>
              {strings.attachSelected}
            </Button>
            <Button
              variant="negative"
              size="sm"
              loading={busy}
              disabled={busy}
              onClick={() => { void handleDetach(); }}
            >
              {interpolate(strings.detachSelected, { count: selection.selectedCount })}
            </Button>
          </BulkActionBar>
          {message !== null ? <p className="text-sm text-success">{message}</p> : null}
          {error !== null ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
      ) : null}

      <div className="divide-y divide-border">
        {filtered.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            locale={locale}
            canManage={canManage}
            selected={selection.selectedIds.has(task.id)}
            onToggle={selection.toggleOne}
            onRemoveTask={onRemoveTask}
          />
        ))}
        {filtered.length === 0 && <EmptyState icon={ClipboardList} title={strings.empty} />}
      </div>
    </div>
  );
}
