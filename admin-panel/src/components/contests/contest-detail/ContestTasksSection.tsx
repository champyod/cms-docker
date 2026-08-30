'use client';

import { Card } from '@/components/core/Card';
import { Button } from '@/components/core/Button';
import { EmptyState } from '@/components/core/EmptyState';
import { ClipboardList, Plus, Trash2, Settings, ChevronDown, ChevronUp } from 'lucide-react';

interface Task { id: number; name: string; title: string; }

interface Props {
  tasks: Task[];
  expanded: boolean;
  locale: string;
  onToggle: () => void;
  onAddTask: () => void;
  onRemoveTask: (id: number) => void;
}

export function ContestTasksSection({ tasks, expanded, locale, onToggle, onAddTask, onRemoveTask }: Props) {
  return (
    <Card className="overflow-hidden">
      <button onClick={onToggle} className="flex w-full items-center justify-between p-4 transition-colors hover:bg-muted/50">
        <div className="flex items-center gap-3"><ClipboardList className="h-5 w-5 text-warning" /><span className="font-bold text-foreground">Tasks ({tasks.length})</span></div>
        {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {expanded && (
        <div>
          <div className="flex justify-end border-b border-border bg-muted/20 p-4">
            <Button variant="positiveOutline" size="sm" icon={Plus} onClick={onAddTask}>Add Task</Button>
          </div>
          <div className="divide-y divide-border">
            {tasks.map((task) => (
              <div key={task.id} className="group flex items-center justify-between p-4 transition-colors hover:bg-muted/50">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-warning/10 text-sm font-bold text-warning">{task.name.substring(0, 2).toUpperCase()}</div>
                  <div>
                    <div className="font-medium text-foreground">{task.name}</div>
                    <div className="text-xs text-muted-foreground">{task.title}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <a href={`/${locale}/tasks/${task.id}`} className="p-1.5 text-muted-foreground transition-colors hover:text-primary"><Settings className="h-4 w-4" /></a>
                  <button onClick={() => onRemoveTask(task.id)} className="p-1.5 text-muted-foreground opacity-0 transition-colors hover:text-destructive group-hover:opacity-100"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            ))}
            {tasks.length === 0 && <EmptyState icon={ClipboardList} title="No tasks assigned to this contest" />}
          </div>
        </div>
      )}
    </Card>
  );
}
