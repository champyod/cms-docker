'use client';

import { useMemo, useState } from 'react';
import { useSyncedState } from '@/hooks/useSyncedState';
import { useActionFeedback } from '@/hooks/useActionFeedback';
import { useRouter, usePathname } from 'next/navigation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/core/Table';
import { Button } from '@/components/core/Button';
import { Pencil, Trash2, Plus, FileText, Database, ExternalLink, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ROW_SELECTED_CLASSES } from '@/hooks/useShortcuts';
import { EmptyState } from '@/components/core/EmptyState';
import { MobileCard, MobileCardRow } from '@/components/core/MobileCard';
import { TaskModal } from './TaskModal';
import { apiClient } from '@/lib/apiClient';
import { hasEffectivePermission } from '@/lib/permission-engine';
import { useConfirm } from '@/hooks/useConfirm';
import { useConfirmationCopy } from '@/hooks/useConfirmationCopy';
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
  permissionKeys: readonly string[];
}

export function TaskList({ initialTasks, permissionKeys }: TaskListProps): React.JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const locale = pathname.split('/')[1] ?? 'en';
  const [tasks] = useSyncedState(initialTasks);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TaskRow | null>(null);
  const confirm = useConfirm();
  const { destructiveConfirm } = useConfirmationCopy();

  const effective = useMemo(() => new Set(permissionKeys), [permissionKeys]);
  const canCreateTasks = hasEffectivePermission(effective, 'task:create');
  const canManageTasks = hasEffectivePermission(effective, 'task:update');
  const canDeleteTasks = hasEffectivePermission(effective, 'task:delete');

  const handleEdit = (task: TaskRow): void => {
    if (!canManageTasks) return;
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

  const handleSuccess = (): void => {
    router.refresh();
  };

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

      <div className="border border-border rounded-xl overflow-hidden bg-card">
        <Table
          mobileCards={tasks.map((task) => (
            <MobileCard key={task.id}>
              <MobileCardRow label="ID" value={`#${task.id}`} />
              <MobileCardRow label="Name" value={task.name} />
              <MobileCardRow label="Title" value={task.title} />
              <MobileCardRow label="Contest" value={task.contests ? task.contests.name : 'Unassigned'} />
              <MobileCardRow label="Submissions" value={task._count?.submissions ?? 0} />
              {canManageTasks && (
                <div className="flex items-center justify-end gap-2 pt-2">
                  <Button variant="ghost" size="sm" icon={Pencil} iconOnly tooltip="Edit task" onClick={() => handleEdit(task)} className="text-muted-foreground hover:text-primary" />
                  <Button variant="ghost" size="sm" icon={Trash2} iconOnly tooltip="Delete task" onClick={() => { void handleDelete(task.id); }} className="text-muted-foreground hover:text-destructive" />
                </div>
              )}
            </MobileCard>
          ))}
        >
          <TableHeader>
            <TableRow className="border-b border-border hover:bg-muted/50">
              <TableHead className="text-muted-foreground">ID</TableHead>
              <TableHead className="text-muted-foreground">Name</TableHead>
              <TableHead className="text-muted-foreground">Title</TableHead>
              <TableHead className="text-muted-foreground">Contest</TableHead>
              <TableHead className="text-muted-foreground">Resources</TableHead>
              <TableHead className="text-muted-foreground">Submissions</TableHead>
              <TableHead className="text-muted-foreground text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((task) => {
              const hasErrors = task.diagnostics.some((d) => d.type === 'error');
              const openDetail = () => router.push(`/${locale}/tasks/${task.id}`, { scroll: false });
              return (
                <TableRow
                  key={task.id}
                  data-shortcut-row
                  onClick={openDetail}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && event.target === event.currentTarget) openDetail();
                  }}
                  tabIndex={0}
                  className={cn('border-b border-border hover:bg-muted/50 transition-colors cursor-pointer', hasErrors && 'opacity-60', ROW_SELECTED_CLASSES)}
                >
                  <TableCell className="font-mono text-muted-foreground text-xs text-nowrap">#{task.id}</TableCell>
                  <TableCell className="font-medium text-foreground max-w-36">
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
                      <button onClick={(event) => { event.stopPropagation(); router.push(`/${locale}/tasks/${task.id}`, { scroll: false }); }} data-shortcut-primary className={cn('flex items-center gap-2 hover:text-primary transition-colors truncate', hasErrors && 'text-muted-foreground')}>
                        {task.name}
                        <ExternalLink className="w-3 h-3 opacity-50" />
                      </button>
                    </div>
                  </TableCell>
                  <TableCell className={`max-w-48 truncate ${hasErrors ? 'text-muted-foreground italic' : 'text-muted-foreground'}`} title={task.title}>
                    {task.title}
                  </TableCell>
                  <TableCell>
                    {task.contests ? (
                      <span className="px-2 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">{task.contests.name}</span>
                    ) : (
                      <span className="text-muted-foreground text-xs italic">Unassigned</span>
                    )}
                  </TableCell>
                  <TableCell>
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
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{task._count?.submissions ?? 0}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2" onClick={(event) => event.stopPropagation()}>
                      {canManageTasks && (
                        <Button variant="ghost" size="sm" icon={Pencil} iconOnly tooltip="Edit task" onClick={() => handleEdit(task)} className="text-muted-foreground hover:text-primary" />
                      )}
                      {canDeleteTasks && (
                        <Button variant="ghost" size="sm" icon={Trash2} iconOnly tooltip="Delete task" onClick={() => { void handleDelete(task.id); }} className="text-muted-foreground hover:text-destructive" />
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {tasks.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-12">
                  <EmptyState icon={FileText} title="No tasks found" description="Create your first task to get started." />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <TaskModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} task={selectedTask as unknown as Parameters<typeof TaskModal>[0]['task']} onSuccess={handleSuccess} permissionKeys={permissionKeys} />
    </div>
  );
}
