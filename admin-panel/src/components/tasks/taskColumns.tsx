'use client';

import { AlertTriangle, Database, ExternalLink, FileText } from 'lucide-react';

import { buildSelectionColumn } from '@/components/core/SelectionColumn';
import type { ResponsiveColumn } from '@/components/core/ResponsiveTable';
import type { ListSelection } from '@/hooks/useListSelection';
import { cn } from '@/lib/utils';
import type { TaskDiagnostic } from '@/lib/task-diagnostics';

export interface TaskRow {
  id: number;
  name: string;
  title: string;
  contests: { name: string } | null;
  statements: Array<{ id: number }>;
  datasets_datasets_task_idTotasks: Array<{ id: number }>;
  _count: { submissions: number };
  diagnostics: TaskDiagnostic[];
}

export interface TaskColumnArgs {
  readonly selection: ListSelection;
  readonly onOpen: (id: number) => void;
}

/**
 * The task list's columns, kept out of the list component so the table's shape
 * lives beside its row type instead of growing the list's render body.
 */
export function buildTaskColumns({ selection, onOpen }: TaskColumnArgs): ResponsiveColumn<TaskRow>[] {
  return [
    buildSelectionColumn<TaskRow>({
      getRowId: (task) => task.id,
      selectedIds: selection.selectedIds,
      allSelected: selection.allSelected,
      partlyChecked: selection.someSelected,
      selectAllLabel: 'Select all tasks',
      selectRowLabel: (task) => `Select task ${task.id}`,
      onToggleAll: selection.toggleAll,
      onToggleOne: selection.toggleOne,
    }),
    {
      key: 'id',
      header: 'ID',
      sortKey: 'id',
      hideOnMobile: true,
      render: (task) => <span className="font-mono text-muted-foreground text-xs text-nowrap">#{task.id}</span>,
    },
    {
      key: 'name',
      header: 'Name',
      sortKey: 'name',
      render: (task) => {
        const hasErrors = task.diagnostics.some((d) => d.type === 'error');
        return (
          <div className="flex items-center gap-2">
            {task.diagnostics.length > 0 && (
              <div className="group relative">
                <AlertTriangle className={cn('w-4 h-4 cursor-help shrink-0', hasErrors ? 'text-destructive' : 'text-warning')} />
                <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block z-50 min-w-48 p-2 bg-popover border border-border rounded-lg shadow-xl text-xs space-y-1">
                  <p className="font-bold border-b border-border pb-1 mb-1">Task Issues</p>
                  {task.diagnostics.map((d, i) => (
                    <div key={i} className={`flex gap-1.5 ${d.type === 'error' ? 'text-destructive' : 'text-warning'}`}>
                      <span>•</span>
                      <span>{d.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <button onClick={(event) => { event.stopPropagation(); onOpen(task.id); }} data-shortcut-primary className={cn('flex items-center gap-2 hover:text-primary transition-colors truncate', hasErrors && 'text-muted-foreground')}>
              {task.name}
              <ExternalLink className="w-3 h-3 opacity-50" />
            </button>
          </div>
        );
      },
    },
    {
      key: 'title',
      header: 'Title',
      sortKey: 'title',
      render: (task) => {
        const hasErrors = task.diagnostics.some((d) => d.type === 'error');
        return (
          <span className={`max-w-48 truncate ${hasErrors ? 'text-muted-foreground italic' : 'text-muted-foreground'}`} title={task.title}>
            {task.title}
          </span>
        );
      },
    },
    {
      key: 'contest',
      header: 'Contest',
      sortKey: 'contests',
      render: (task) =>
        task.contests ? (
          <span className="px-2 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">{task.contests.name}</span>
        ) : (
          <span className="text-muted-foreground text-xs italic">Unassigned</span>
        ),
    },
    {
      key: 'resources',
      header: 'Resources',
      render: (task) => (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1" title="Statements">
            <FileText className="w-3 h-3" />
            <span>{task.statements.length}</span>
          </div>
          <div className="flex items-center gap-1" title="Datasets">
            <Database className="w-3 h-3" />
            <span>{task.datasets_datasets_task_idTotasks.length}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'submissions',
      header: 'Submissions',
      sortKey: 'submissions',
      render: (task) => <span>{task._count?.submissions ?? 0}</span>,
    },
  ];
}
