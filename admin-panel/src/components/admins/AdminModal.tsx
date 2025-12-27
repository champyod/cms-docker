'use client';

import { useState } from 'react';
import { X, Shield, Loader, Eye, EyeOff } from 'lucide-react';
import { createAdmin } from '@/app/actions/admins';

interface AdminModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function AdminModal({ isOpen, onClose, onSuccess }: AdminModalProps) {
  const [formData, setFormData] = useState({
    name: '',
    username: '',
    password: '',
    permission_all: false,
    permission_messaging: true,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.username.trim() || !formData.password.trim()) {
      setError('All fields are required');
      return;
    }

    setLoading(true);
    setError('');

    const result = await createAdmin(formData);
    if (result.success) {
      onSuccess();
      onClose();
      setFormData({ name: '', username: '', password: '', permission_all: false, permission_messaging: true });
    } else {
      setError(result.error || 'Failed to create admin');
    }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative z-10 w-full max-w-md bg-neutral-900 border border-white/10 rounded-xl shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-purple-400" />
            <h2 className="text-lg font-bold text-white">Add Administrator</h2>
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
            <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Display Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., John Doe"
              className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-lg text-white focus:outline-none focus:border-indigo-500/50"
            />
          </div>
          
          <div>
            <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Username</label>
            <input
              type="text"
              value={formData.username}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              placeholder="e.g., johnd"
              className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-lg text-white focus:outline-none focus:border-indigo-500/50"
            />
          </div>
          
          <div>
            <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-lg text-white focus:outline-none focus:border-indigo-500/50 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between p-3 bg-black/30 rounded-lg">
              <div>
                <label className="text-sm text-neutral-300 font-medium">Full Permissions</label>
                <p className="text-xs text-neutral-500">Can manage everything (users, contests, tasks)</p>
              </div>
              <input
                type="checkbox"
                checked={formData.permission_all}
                onChange={(e) => setFormData({ ...formData, permission_all: e.target.checked })}
                className="w-5 h-5 rounded"
              />
            </div>
            <div className="flex items-center justify-between p-3 bg-black/30 rounded-lg">
              <div>
                <label className="text-sm text-neutral-300 font-medium">Messaging Only</label>
                <p className="text-xs text-neutral-500">Can only view/reply to questions and announcements</p>
              </div>
              <input
                type="checkbox"
                checked={formData.permission_messaging}
                onChange={(e) => setFormData({ ...formData, permission_messaging: e.target.checked })}
                className="w-5 h-5 rounded"
              />
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
              className="flex-1 px-4 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? <Loader className="w-4 h-4 animate-spin" /> : null}
              {loading ? 'Creating...' : 'Create Admin'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
