'use client';

import { Card } from '@/components/core/Card';
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
    <Card className="glass-card border-white/5 overflow-hidden">
      <button onClick={onToggle} className="w-full p-4 flex items-center justify-between hover:bg-white/5 transition-colors">
        <div className="flex items-center gap-3"><ClipboardList className="w-5 h-5 text-amber-400" /><span className="font-bold text-white">Tasks ({tasks.length})</span></div>
        {expanded ? <ChevronUp className="w-4 h-4 text-neutral-400" /> : <ChevronDown className="w-4 h-4 text-neutral-400" />}
      </button>
      {expanded && (
        <div>
          <div className="p-4 border-b border-white/5 bg-black/20 flex justify-end"><button onClick={onAddTask} className="flex items-center gap-2 px-3 py-1.5 bg-amber-600/20 text-amber-400 rounded-lg text-sm hover:bg-amber-600/30 transition-colors"><Plus className="w-4 h-4" />Add Task</button></div>
          <div className="divide-y divide-white/5">
            {tasks.map((task) => (
              <div key={task.id} className="p-4 flex items-center justify-between hover:bg-white/5 transition-colors group">
                <div className="flex items-center gap-3"><div className="w-8 h-8 rounded-lg bg-amber-600/20 flex items-center justify-center text-amber-400 font-bold text-sm">{task.name.substring(0, 2).toUpperCase()}</div><div><div className="font-medium text-white">{task.name}</div><div className="text-xs text-neutral-500">{task.title}</div></div></div>
                <div className="flex items-center gap-3"><a href={`/${locale}/tasks/${task.id}`} className="p-1.5 text-neutral-500 hover:text-indigo-400 transition-colors"><Settings className="w-4 h-4" /></a><button onClick={() => onRemoveTask(task.id)} className="p-1.5 text-neutral-500 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"><Trash2 className="w-4 h-4" /></button></div>
              </div>
            ))}
            {tasks.length === 0 && <div className="p-8 text-center text-neutral-500 text-sm">No tasks assigned to this contest</div>}
          </div>
        </div>
      )}
    </Card>
  );
}
