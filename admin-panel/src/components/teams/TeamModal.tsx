'use client';

import { useState, useEffect } from 'react';
import { X, Users, Loader } from 'lucide-react';
import { createTeam, updateTeam } from '@/app/actions/teams';

interface TeamData {
  id?: number;
  code: string;
  name: string;
}

interface TeamModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialData?: TeamData | null;
}

export function TeamModal({ isOpen, onClose, onSuccess, initialData }: TeamModalProps) {
  const [formData, setFormData] = useState({ code: '', name: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (initialData) {
      setFormData({ code: initialData.code, name: initialData.name });
    } else {
      setFormData({ code: '', name: '' });
    }
    setError('');
  }, [initialData, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.code.trim() || !formData.name.trim()) {
      setError('All fields are required');
      return;
    }

    setLoading(true);
    setError('');

    let result;
    if (initialData && initialData.id) {
      result = await updateTeam(initialData.id, formData);
    } else {
      result = await createTeam(formData);
    }

    if (result.success) {
      onSuccess();
      onClose();
    } else {
      setError(result.error || 'Operation failed');
    }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative z-10 w-full max-w-md bg-neutral-900 border border-white/10 rounded-xl shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-400" />
            <h2 className="text-lg font-bold text-white">{initialData ? 'Edit Team' : 'Add Team'}</h2>
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
            <label className="block text-sm font-medium text-neutral-400 mb-1">
              Team Code
            </label>
            <input
              type="text"
              value={formData.code}
              onChange={(e) => setFormData({ ...formData, code: e.target.value })}
              className="w-full px-4 py-3 bg-neutral-800 border border-white/10 rounded-lg text-white placeholder-neutral-500 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all font-mono"
              placeholder="e.g. THA-01"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-400 mb-1">
              Team Name
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-4 py-3 bg-neutral-800 border border-white/10 rounded-lg text-white placeholder-neutral-500 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all"
              placeholder="e.g. Thailand Team 1"
            />
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
              className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? <Loader className="w-4 h-4 animate-spin" /> : null}
              {loading ? (initialData ? 'Updating...' : 'Creating...') : (initialData ? 'Update Team' : 'Create Team')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
