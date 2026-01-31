'use client';

import { useState, useEffect } from 'react';
import { X, Plus, Search, ClipboardList } from 'lucide-react';
import { Portal } from '../core/Portal';
import { addTaskToContest } from '@/app/actions/contests';

interface TaskSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  contestId: number;
  availableTasks: any[];
  onSuccess?: () => void;
}

export function TaskSelectionModal({ isOpen, onClose, contestId, availableTasks, onSuccess }: TaskSelectionModalProps) {
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState<number | null>(null);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const filteredTasks = availableTasks.filter((t: any) =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.title.toLowerCase().includes(search.toLowerCase())
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
    <Portal>
      <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
        <div className="relative z-10 w-full max-w-md mx-4 bg-neutral-900 border border-white/10 rounded-xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-indigo-400" />
            <h2 className="text-lg font-bold text-white">Add Task to Contest</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg transition-colors">
            <X className="w-5 h-5 text-neutral-400" />
          </button>
        </div>
        
        <div className="p-4">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
            <input
              type="text"
              placeholder="Search tasks..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-black/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500/50"
            />
          </div>
          
          <div className="max-h-64 overflow-y-auto space-y-2">
            {filteredTasks.length === 0 ? (
              <p className="text-neutral-500 text-sm text-center py-4">No available tasks found</p>
            ) : (
              filteredTasks.map((task: any) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between p-3 bg-black/30 rounded-lg hover:bg-black/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-indigo-600/20 flex items-center justify-center text-indigo-400 font-bold text-sm">
                      {task.name.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-white">{task.name}</div>
                      <div className="text-xs text-neutral-500">{task.title}</div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleAdd(task.id)}
                    disabled={adding === task.id}
                    className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded-lg transition-colors disabled:opacity-50"
                  >
                    {adding === task.id ? 'Adding...' : 'Add'}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
    </Portal>
  );
}
