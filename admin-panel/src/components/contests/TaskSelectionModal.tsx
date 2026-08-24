'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import { addTaskToContest } from '@/app/actions/contests';
import { Dialog } from '@/components/core/Dialog';
import { Button } from '@/components/core/Button';

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
}

export function TaskSelectionModal({ isOpen, onClose, contestId, availableTasks, onSuccess }: TaskSelectionModalProps) {
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState<number | null>(null);

  const filteredTasks = availableTasks.filter((task) =>
    task.name.toLowerCase().includes(search.toLowerCase()) ||
    task.title.toLowerCase().includes(search.toLowerCase())
  );

  const handleAdd = async (taskId: number) => {
    setAdding(taskId);
    try {
      await addTaskToContest(contestId, taskId);
      if (onSuccess) onSuccess();
      else window.location.reload();
    } catch (error) {
      console.error('Failed to add task:', error);
    } finally {
      setAdding(null);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }} title="Add Task to Contest" className="sm:max-w-md">
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search tasks..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-border bg-muted/50 py-2 pl-10 pr-4 text-sm text-foreground focus:border-primary/50 focus:outline-none"
        />
      </div>

      <div className="max-h-64 space-y-2 overflow-y-auto">
        {filteredTasks.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No available tasks found</p>
        ) : (
          filteredTasks.map((task) => (
            <div key={task.id} className="flex items-center justify-between rounded-lg bg-muted/30 p-3 transition-colors hover:bg-muted/50">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary">
                  {task.name.substring(0, 2).toUpperCase()}
                </div>
                <div>
                  <div className="text-sm font-medium text-foreground">{task.name}</div>
                  <div className="text-xs text-muted-foreground">{task.title}</div>
                </div>
              </div>
              <Button size="sm" variant="positive" loading={adding === task.id} disabled={adding === task.id} onClick={() => handleAdd(task.id)}>Add</Button>
            </div>
          ))
        )}
      </div>
    </Dialog>
  );
}
