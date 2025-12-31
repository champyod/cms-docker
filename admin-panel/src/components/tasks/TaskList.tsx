'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/core/Table';
import { Button } from '@/components/core/Button';
import { Edit2, Trash2, Plus, FileText, Database, ExternalLink, AlertTriangle } from 'lucide-react';
import { TaskModal } from './TaskModal';
import { apiClient } from '@/lib/apiClient';
import { tasks } from '@prisma/client';
import { TaskDiagnostic } from '@/app/actions/tasks';

type TaskWithRelations = tasks & {
  contests: { id: number; name: string } | null;
  statements: { id: number }[];
  datasets_datasets_task_idTotasks: { id: number; description: string }[];
  _count: { submissions: number };
  diagnostics: TaskDiagnostic[];
};

export function TaskList({ initialTasks, totalPages }: { initialTasks: TaskWithRelations[], totalPages: number }) {
  const router = useRouter();
  const [tasks] = useState(initialTasks);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TaskWithRelations | null>(null);

  const handleEdit = (task: TaskWithRelations) => {
    setSelectedTask(task);
    setIsModalOpen(true);
  };

  const handleDelete = async (id: number) => {
    if (confirm('Are you sure you want to delete this task? This is IRREVERSIBLE.')) {
      const result = await apiClient.delete(`/api/tasks/${id}`);
      if (result.success) {
        window.location.reload();
      } else {
        alert('Failed to delete task: ' + result.error);
      }
    }
  };

  const handleCreate = () => {
    setSelectedTask(null);
    setIsModalOpen(true);
  };

  const handleSuccess = () => {
    window.location.reload();
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-white">All Tasks</h2>
        <Button 
          variant="primary" 
          className="flex items-center gap-2 bg-indigo-500 hover:bg-indigo-600 text-white pl-3 pr-4"
          onClick={handleCreate}
        >
          <Plus className="w-4 h-4" />
          Create Task
        </Button>
      </div>

      <div className="border border-white/5 rounded-xl overflow-hidden bg-neutral-900/40 backdrop-blur-sm">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-white/5 hover:bg-white/5">
              <TableHead className="text-neutral-400">ID</TableHead>
              <TableHead className="text-neutral-400">Name</TableHead>
              <TableHead className="text-neutral-400">Title</TableHead>
              <TableHead className="text-neutral-400">Contest</TableHead>
              <TableHead className="text-neutral-400">Resources</TableHead>
              <TableHead className="text-neutral-400 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((task) => {
              const hasErrors = task.diagnostics.some(d => d.type === 'error');
              const hasWarnings = task.diagnostics.some(d => d.type === 'warning');

              return (
                <TableRow key={task.id} className={`border-b border-white/5 hover:bg-white/5 transition-colors ${hasErrors ? 'opacity-60' : ''}`}>
                  <TableCell className="font-mono text-neutral-500 text-xs text-nowrap">#{task.id}</TableCell>
                  <TableCell className="font-medium text-white max-w-[150px]">
                    <div className="flex items-center gap-2">
                      {task.diagnostics.length > 0 && (
                        <div className="group relative">
                          <AlertTriangle className={`w-4 h-4 cursor-help shrink-0 ${hasErrors ? 'text-red-500' : 'text-amber-500'}`} />
                          <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block z-50 min-w-[200px] p-2 bg-neutral-800 border border-white/10 rounded-lg shadow-xl text-xs space-y-1">
                            <p className="font-bold border-b border-white/5 pb-1 mb-1">Task Issues</p>
                            {task.diagnostics.map((d, i) => (
                              <div key={i} className={`flex gap-1.5 ${d.type === 'error' ? 'text-red-400' : 'text-amber-400'}`}>
                                <span>•</span>
                                <span>{d.message}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <button
                        onClick={() => router.push(`/en/tasks/${task.id}`)}
                        className={`flex items-center gap-2 hover:text-indigo-400 transition-colors truncate ${hasErrors ? 'text-neutral-400' : ''}`}
                      >
                        {task.name}
                        <ExternalLink className="w-3 h-3 opacity-50" />
                      </button>
                    </div>
                  </TableCell>
                  <TableCell className={`max-w-[200px] truncate ${hasErrors ? 'text-neutral-500 italic' : 'text-neutral-300'}`} title={task.title}>
                    {task.title}
                  </TableCell>
                  <TableCell>
                    {task.contests ? (
                      <span className="px-2 py-1 rounded-full text-xs font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                        {task.contests.name}
                      </span>
                    ) : (
                        <span className="text-neutral-500 text-xs italic">Unassigned</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3 text-xs text-neutral-400">
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
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEdit(task)}
                        className="h-8 w-8 p-0 text-neutral-400 hover:text-indigo-400"
                      >
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(task.id)}
                        className="h-8 w-8 p-0 text-neutral-400 hover:text-red-400"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {tasks.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12 text-neutral-500">
                  No tasks found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      
      <TaskModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        task={selectedTask}
        onSuccess={handleSuccess}
      />
    </div>
  );
}
