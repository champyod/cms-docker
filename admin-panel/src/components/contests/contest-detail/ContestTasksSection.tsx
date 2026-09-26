'use client';

import Link from 'next/link';
import { Button } from '@/components/core/Button';
import { EmptyState } from '@/components/core/EmptyState';
import { SectionCard } from '@/components/core/SectionCard';
import { hasEffectivePermission } from '@/lib/permission-engine';
import { buildRoute } from '@/lib/navigation/routes';
import { ClipboardList, Plus, Trash2, Settings } from 'lucide-react';

interface Task { id: number; name: string; title: string; }

interface Props {
  tasks: Task[];
  expanded: boolean;
  locale: string;
  permissionKeys: readonly string[];
  onToggle: () => void;
  onAddTask: () => void;
  onRemoveTask: (id: number) => void;
}

// Why: task assignment is a write action — readers without task:update see
// the roster but never a dead Add/Remove affordance.
function useCanManageTasks(permissionKeys: readonly string[]): boolean {
  return hasEffectivePermission(new Set(permissionKeys), 'task:update');
}

function TaskRow({ task, locale, canManage, onRemoveTask }: { task: Task; locale: string; canManage: boolean; onRemoveTask: (id: number) => void }): React.JSX.Element {
  return (
    <div className="group flex items-center justify-between p-4 transition-colors hover:bg-muted/50">
      <div className="flex items-center gap-3">
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

export function ContestTasksSection({ tasks, expanded, locale, permissionKeys, onToggle, onAddTask, onRemoveTask }: Props): React.JSX.Element {
  const canManage = useCanManageTasks(permissionKeys);
  return (
    <SectionCard
      title="Tasks"
      icon={<ClipboardList className="h-5 w-5 text-warning" />}
      count={tasks.length}
      expanded={expanded}
      onToggle={onToggle}
    >
      {canManage && (
        <div className="flex justify-end border-b border-border bg-muted/20 p-4">
          <Button variant="positiveOutline" size="sm" icon={Plus} onClick={onAddTask}>Add Task</Button>
        </div>
      )}
      <div className="divide-y divide-border">
        {tasks.map((task) => (
          <TaskRow key={task.id} task={task} locale={locale} canManage={canManage} onRemoveTask={onRemoveTask} />
        ))}
        {tasks.length === 0 && <EmptyState icon={ClipboardList} title="No tasks assigned to this contest" />}
      </div>
    </SectionCard>
  );
}
