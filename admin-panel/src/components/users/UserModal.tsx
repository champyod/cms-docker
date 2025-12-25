'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { X, Loader2 } from 'lucide-react';
import { createUser, updateUser } from '@/app/actions/users';

import { users } from '@/generated/prisma/client';

interface UserModalProps {
  isOpen: boolean;
  onClose: () => void;
  user?: users | null; // If present, edit mode
  onSuccess: () => void;
}

export function UserModal({ isOpen, onClose, user, onSuccess }: UserModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    username: '',
    email: '',
    password: '',
    timezone: '',
  });

  useEffect(() => {
    if (user) {
      setFormData({
        first_name: user.first_name,
        last_name: user.last_name,
        username: user.username,
        email: user.email || '',
        password: '', // Don't fill password on edit
        timezone: user.timezone || '',
      });
    } else {
      setFormData({
        first_name: '',
        last_name: '',
        username: '',
        email: '',
        password: '',
        timezone: '',
      });
    }
  }, [user, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      let result;
      if (user) {
        result = await updateUser(user.id, formData);
      } else {
        result = await createUser(formData);
      }

      if (result.success) {
        onSuccess();
        onClose();
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <Card className="w-full max-w-md p-6 relative animate-in fade-in zoom-in-95 duration-200">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-neutral-400 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <h2 className="text-xl font-bold text-white mb-6">
          {user ? 'Edit User' : 'Create New User'}
        </h2>

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-neutral-400">First Name</label>
              <input
                required
                type="text"
                value={formData.first_name}
                onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                className="w-full px-3 py-2 bg-neutral-900/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all"
                placeholder="John"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-neutral-400">Last Name</label>
              <input
                required
                type="text"
                value={formData.last_name}
                onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                className="w-full px-3 py-2 bg-neutral-900/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all"
                placeholder="Doe"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-neutral-400">Username</label>
            <input
              required
              disabled={!!user} // Username usually shouldn't change
              type="text"
              value={formData.username}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              className="w-full px-3 py-2 bg-neutral-900/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all disabled:opacity-50"
              placeholder="johndoe"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-neutral-400">Email (Optional)</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-3 py-2 bg-neutral-900/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all"
              placeholder="john@example.com"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-neutral-400">
              {user ? 'New Password (leave blank to keep)' : 'Password'}
            </label>
            <input
              required={!user}
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              className="w-full px-3 py-2 bg-neutral-900/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all"
              placeholder="••••••••"
            />
          </div>

           <div className="space-y-1.5">
            <label className="text-xs font-medium text-neutral-400">Timezone</label>
            <input
              type="text"
              value={formData.timezone}
              onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
              className="w-full px-3 py-2 bg-neutral-900/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all"
              placeholder="UTC"
            />
          </div>

          <div className="pt-4 flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button 
              type="submit" 
              variant="primary" 
              className="bg-indigo-500 hover:bg-indigo-600 text-white min-w-[100px]"
              disabled={loading}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : (user ? 'Save Changes' : 'Create User')}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
