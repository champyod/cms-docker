'use client';

import { useCallback, useMemo, useState } from 'react';
import { useSyncedState } from '@/hooks/useSyncedState';
import { useActionFeedback } from '@/hooks/useActionFeedback';
import { usePathname } from 'next/navigation';
import { useAppRouter } from '@/hooks/useAppRouter';
import { ResponsiveTable } from '@/components/core/ResponsiveTable';
import { Button } from '@/components/core/Button';
import { RowActions, rowActionGroupLabel, type RowAction } from '@/components/core/RowActions';
import { Pencil, Trash2, Plus, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ROW_SELECTED_CLASSES } from '@/hooks/shortcut-rows';
import { EmptyState } from '@/components/core/EmptyState';
import type { ListSortInput } from '@/lib/list-sorting';
import { TaskModal } from './TaskModal';
import { TaskBulkAssignDialog } from './TaskBulkAssignDialog';
import { buildTaskColumns, type TaskRow } from './taskColumns';
import { RecordListPager } from '@/components/list/RecordListPager';
import { BulkActionBar } from '@/components/core/BulkActionBar';
import { ApplyLimitsButton } from '@/components/limits/ApplyLimitsButton';
import { useListSelection } from '@/hooks/useListSelection';
import { apiClient } from '@/lib/apiClient';
import { unsetLimitPatch } from '@/lib/limit-patch';
import { hasEffectivePermission, ACTION_PERMISSIONS } from '@/lib/permission-engine';
import { buildRoute } from '@/lib/navigation/routes';
import { useConfirm } from '@/hooks/useConfirm';
import { useConfirmationCopy } from '@/hooks/useConfirmationCopy';
import { useDictionary } from '@/hooks/useDictionary';

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
  const [isAssignOpen, setIsAssignOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TaskRow | null>(null);
  const confirm = useConfirm();
  const { destructiveConfirm, removeTaskFromContestConfirm } = useConfirmationCopy();
  const dict = useDictionary();

  const effective = useMemo(() => new Set(permissionKeys), [permissionKeys]);
  const canCreateTasks = hasEffectivePermission(effective, ACTION_PERMISSIONS.createTask);
  const canUpdateTasks = hasEffectivePermission(effective, ACTION_PERMISSIONS.updateTask);
  const canDeleteTasks = hasEffectivePermission(effective, ACTION_PERMISSIONS.deleteTask);
  // Why both: the assign route and the service it reuses demand task:update and
  // task:switch_dataset, so the bar only offers what the writer will accept.
  const canAssignToContest = canUpdateTasks && effective.has('task:switch_dataset');

  const taskIds = useMemo(() => tasks.map((task) => task.id), [tasks]);
  const selection = useListSelection('tasks.list', taskIds);

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

  const handleAssigned = (): void => {
    selection.clear();
    router.refresh();
  };

  const handleUnassign = async (): Promise<void> => {
    if (!canAssignToContest || selection.selectedCount === 0) return;
    if (!(await confirm(removeTaskFromContestConfirm()))) return;
    const result = await runAction(
      { pending: 'Unassigning tasks...', success: 'Tasks unassigned', failure: 'Failed to unassign tasks' },
      () => apiClient.post('/api/tasks/batch', { action: 'assign', taskIds: [...selection.selectedIds], contestIds: [] }),
    );
    if (result?.success) handleAssigned();
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

  const handleOpenTask = useCallback((id: number) => {
    router.push(buildRoute(locale, 'tasks.record', { id }));
  }, [router, locale]);

  const columns = useMemo(() => buildTaskColumns({ selection, onOpen: handleOpenTask }), [selection, handleOpenTask]);

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

      {/* Why one bar with two gates: assignment additionally needs task:switch_dataset while
          editing limits needs task:update alone, so each group renders behind its own gate and an
          operator who may not move tasks still reaches the limits entry. */}
      {canUpdateTasks && (
        <BulkActionBar selectedCount={selection.selectedCount} onClear={selection.clear}>
          {canAssignToContest && (
            <>
              <Button variant="secondary" onClick={() => setIsAssignOpen(true)}>Assign to contest</Button>
              <Button variant="secondary" onClick={() => { void handleUnassign(); }}>Unassign</Button>
            </>
          )}
          {/* Why both kinds: the row selection seeds this list's own kind, and Q4 lets the operator
              add the other kind in the same picker instead of opening a second dialog. */}
          <ApplyLimitsButton
            kinds={['contest', 'task']}
            preselected={{ task: [...selection.selectedIds] }}
            initiallyTouched={false}
            patch={unsetLimitPatch()}
            label={dict.limits.apply.editButton}
            onSuccess={() => router.refresh()}
          />
        </BulkActionBar>
      )}

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

      <TaskModal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setSelectedTask(null); }} task={selectedTask as never} onSuccess={() => { setIsModalOpen(false); router.refresh(); }} permissionKeys={permissionKeys} />

      <TaskBulkAssignDialog
        isOpen={isAssignOpen}
        onClose={() => setIsAssignOpen(false)}
        taskIds={[...selection.selectedIds]}
        onSuccess={handleAssigned}
      />
    </div>
  );
}
