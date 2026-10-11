'use client';

import { useMemo, useState } from 'react';
import { useSyncedState } from '@/hooks/useSyncedState';
import { useActionFeedback } from '@/hooks/useActionFeedback';
import { usePathname } from 'next/navigation';
import { useAppRouter } from '@/hooks/useAppRouter';
import { ResponsiveTable, type ResponsiveColumn } from '@/components/core/ResponsiveTable';
import { Button } from '@/components/core/Button';
import { RowActions, rowActionGroupLabel, type RowAction } from '@/components/core/RowActions';
import { Pencil, Trash2, Plus, FileText, Database, ExternalLink, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ROW_SELECTED_CLASSES } from '@/hooks/shortcut-rows';
import { EmptyState } from '@/components/core/EmptyState';
import type { ListSortInput } from '@/lib/list-sorting';
import { TaskModal } from './TaskModal';
import { RecordListPager } from '@/components/list/RecordListPager';
import { apiClient } from '@/lib/apiClient';
import { hasEffectivePermission, ACTION_PERMISSIONS } from '@/lib/permission-engine';
import { buildRoute } from '@/lib/navigation/routes';
import { useConfirm } from '@/hooks/useConfirm';
import { useConfirmationCopy } from '@/hooks/useConfirmationCopy';
import { useDictionary } from '@/hooks/useDictionary';
import type { TaskDiagnostic } from '@/lib/task-diagnostics';

interface TaskRow {
  id: number;
  name: string;
  title: string;
  contests: { name: string } | null;
  statements: Array<{ id: number }>;
  datasets_datasets_task_idTotasks: Array<{ id: number }>;
  _count: { submissions: number };
  diagnostics: TaskDiagnostic[];
}

interface TaskListProps {
  initialTasks: TaskRow[];
  totalPages: number;
  currentPage: number;
  permissionKeys: readonly string[];
  initialSort?: ListSortInput;
}

function buildTaskRowActions(
  task: TaskRow,
  onEdit: (task: TaskRow) => void,
  onDelete: (id: number) => void,
): RowAction[] {
  return [
    { key: 'edit', label: 'Edit task', icon: Pencil, onClick: () => onEdit(task), permission: ACTION_PERMISSIONS.updateTask, className: 'text-muted-foreground hover:text-primary' },
    { key: 'delete', label: 'Delete task', icon: Trash2, onClick: () => { void onDelete(task.id); }, permission: ACTION_PERMISSIONS.deleteTask, className: 'text-muted-foreground hover:text-destructive' },
  ];
}

export function TaskList({ initialTasks, totalPages, currentPage, permissionKeys, initialSort }: TaskListProps): React.JSX.Element {
  const router = useAppRouter();
  const pathname = usePathname();
  const locale = pathname.split('/')[1] ?? 'en';
  const [tasks] = useSyncedState(initialTasks);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TaskRow | null>(null);
  const confirm = useConfirm();
  const { destructiveConfirm } = useConfirmationCopy();
  const dict = useDictionary();

  const effective = useMemo(() => new Set(permissionKeys), [permissionKeys]);
  const canCreateTasks = hasEffectivePermission(effective, ACTION_PERMISSIONS.createTask);
  const canUpdateTasks = hasEffectivePermission(effective, ACTION_PERMISSIONS.updateTask);
  const canDeleteTasks = hasEffectivePermission(effective, ACTION_PERMISSIONS.deleteTask);

  const handleEdit = (task: TaskRow): void => {
    if (!canUpdateTasks) return;
    setSelectedTask(task);
    setIsModalOpen(true);
  };

  const runAction = useActionFeedback();

  const handleDelete = async (id: number): Promise<void> => {
    if (!canDeleteTasks) return;
    if (!(await confirm(destructiveConfirm('task')))) return;
    const result = await runAction(
      { pending: 'Deleting task...', success: 'Task deleted', failure: 'Failed to delete task' },
      () => apiClient.delete(`/api/tasks/${id}`)
    );
    if (result?.success) router.refresh();
  };

  const handleCreate = (): void => {
    if (!canCreateTasks) return;
    setSelectedTask(null);
    setIsModalOpen(true);
  };

  const handlePageChange = (next: number): void => {
    const url = new URL(window.location.href);
    url.searchParams.set('page', String(next));
    router.push(url.toString());
  };

  const applySort = (next: ListSortInput): void => {
    const url = new URL(window.location.href);
    if (next !== null && next !== undefined) {
      url.searchParams.set('sort', next.key);
      url.searchParams.set('dir', next.direction);
    } else {
      url.searchParams.delete('sort');
      url.searchParams.delete('dir');
    }
    url.searchParams.set('page', '1');
    router.push(url.toString());
  };

  const columns = useMemo<ResponsiveColumn<TaskRow>[]>(() => [
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
            <button onClick={(event) => { event.stopPropagation(); router.push(buildRoute(locale, 'tasks.record', { id: task.id })); }} data-shortcut-primary className={cn('flex items-center gap-2 hover:text-primary transition-colors truncate', hasErrors && 'text-muted-foreground')}>
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
  ], [locale, router]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-foreground">All Tasks</h2>
        {canCreateTasks && (
          <Button variant="positive" icon={Plus} onClick={handleCreate}>
            Create Task
          </Button>
        )}
      </div>

      <ResponsiveTable
        columns={columns}
        rows={tasks}
        getRowKey={(task) => task.id}
        getRowClassName={(task) => cn(
          'border-b border-border hover:bg-muted/50 transition-colors cursor-pointer',
          task.diagnostics.some((d) => d.type === 'error') && 'opacity-60',
          ROW_SELECTED_CLASSES,
        )}
        getRowProps={(task) => ({
          'data-shortcut-row': task.id,
          tabIndex: 0,
          onClick: () => router.push(buildRoute(locale, 'tasks.record', { id: task.id })),
          onKeyDown: (event) => {
            if (event.key === 'Enter' && event.target === event.currentTarget) {
              router.push(buildRoute(locale, 'tasks.record', { id: task.id }));
            }
          },
        })}
        renderRowActions={(task) => (
          <RowActions
            ariaLabel={rowActionGroupLabel(dict, 'tasks')}
            permissionKeys={permissionKeys}
            actions={buildTaskRowActions(task, handleEdit, handleDelete)}
          />
        )}
        sort={initialSort}
        onSortChange={applySort}
        emptyState={<EmptyState icon={FileText} title="No tasks found" />}
      />

      {totalPages > 1 && (
        <RecordListPager currentPage={currentPage} totalPages={totalPages} onPageChange={handlePageChange} />
      )}

      <TaskModal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setSelectedTask(null); }} task={selectedTask as never} onSuccess={() => { setIsModalOpen(false); router.refresh(); }} />
    </div>
  );
}
