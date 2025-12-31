'use client';

import { useState, useEffect } from 'react';
import { X, Database, Loader2, Plus, Trash2, CheckCircle2 } from 'lucide-react';
import { Portal } from '../core/Portal';
import { apiClient } from '@/lib/apiClient';

interface DatasetModalProps {
  isOpen: boolean;
  onClose: () => void;
  taskId: number;
  onSuccess: () => void;
}

const TASK_TYPES = ['Batch', 'OutputOnly', 'Communication', 'TwoSteps'];
const SCORE_TYPES = ['Sum', 'GroupMin', 'GroupMul', 'GroupThreshold'];

export function DatasetModal({ isOpen, onClose, taskId, onSuccess }: DatasetModalProps) {
  const [formData, setFormData] = useState({
    description: '',
    time_limit: 1,
    memory_limit: 256,
    task_type: 'Batch',
    score_type: 'Sum',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await apiClient.post('/api/datasets', {
        taskId,
        ...formData
      });

      if (result.success) {
        onSuccess();
        onClose();
        setFormData({ description: '', time_limit: 1, memory_limit: 256, task_type: 'Batch', score_type: 'Sum' });
      } else {
        setError(result.error || 'An error occurred');
      }
    } catch (err) {
      console.error('Dataset creation error:', err);
      // @ts-ignore
      setError(err.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Portal>
      <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
        <div className="relative z-10 w-full max-w-lg bg-neutral-900 border border-white/10 rounded-xl shadow-2xl" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between p-4 border-b border-white/10">
            <div className="flex items-center gap-2">
              <Database className="w-5 h-5 text-amber-400" />
              <h2 className="text-lg font-bold text-white">Create Dataset</h2>
            </div>
            <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg transition-colors">
              <X className="w-5 h-5 text-neutral-400" />
            </button>
          </div>
        
        {error && (
          <div className="mx-4 mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Description</label>
            <input
              type="text"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="e.g., Default, v2, IOI 2024"
              required
              className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-lg text-white focus:outline-none focus:border-indigo-500/50"
            />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Time Limit (s)</label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                value={formData.time_limit}
                onChange={(e) => setFormData({ ...formData, time_limit: parseFloat(e.target.value) })}
                className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-lg text-white focus:outline-none focus:border-indigo-500/50"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Memory Limit (MiB)</label>
              <input
                type="number"
                min="16"
                value={formData.memory_limit}
                onChange={(e) => setFormData({ ...formData, memory_limit: parseInt(e.target.value) })}
                className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-lg text-white focus:outline-none focus:border-indigo-500/50"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Task Type</label>
              <select
                value={formData.task_type}
                onChange={(e) => setFormData({ ...formData, task_type: e.target.value })}
                className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-lg text-white focus:outline-none focus:border-indigo-500/50"
              >
                {TASK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Score Type</label>
              <select
                value={formData.score_type}
                onChange={(e) => setFormData({ ...formData, score_type: e.target.value })}
                className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-lg text-white focus:outline-none focus:border-indigo-500/50"
              >
                {SCORE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-3 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-3 bg-amber-600 hover:bg-amber-500 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Dataset'}
            </button>
          </div>
        </form>
      </div>
    </div>
    </Portal>
  );
}
