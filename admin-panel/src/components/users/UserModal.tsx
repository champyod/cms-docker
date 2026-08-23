'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { X, Loader2 } from 'lucide-react';
import { apiClient } from '@/lib/apiClient';
import { useToast } from '@/components/providers/ToastProvider';
import { PasswordFieldWithGenerator } from '@/components/core/PasswordFieldWithGenerator';
import { Portal } from '@/components/core/Portal';
import { cn } from '@/lib/utils';
import type { UsersPageRow } from '@/lib/prisma-selects';

const DEFAULT_TIMEZONE = 'Asia/Bangkok';

interface UserFormState {
  first_name: string;
  last_name: string;
  username: string;
  email: string;
  password: string;
  timezone: string;
  contestId: string;
  teamCode: string;
}

const EMPTY_USER_FORM: UserFormState = {
  first_name: '',
  last_name: '',
  username: '',
  email: '',
  password: '',
  timezone: DEFAULT_TIMEZONE,
  contestId: '',
  teamCode: '',
};

function formFromUser(user: UsersPageRow): UserFormState {
  return {
    ...EMPTY_USER_FORM,
    first_name: user.first_name,
    last_name: user.last_name,
    username: user.username,
    email: user.email || '',
    timezone: user.timezone || DEFAULT_TIMEZONE,
  };
}

interface UserModalProps {
  isOpen: boolean;
  onClose: () => void;
  user?: UsersPageRow | null;
  contests?: Array<{ id: number; name: string }>;
  onSuccess: () => void;
}

export function UserModal({ isOpen, onClose, user, contests = [], onSuccess }: UserModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { addToast } = useToast();
  const [formData, setFormData] = useState<UserFormState>(EMPTY_USER_FORM);

  useEffect(() => {
    setFormData(user ? formFromUser(user) : EMPTY_USER_FORM);
  }, [user, isOpen]);

  if (!isOpen) return null;

  const updateForm = (updates: Partial<UserFormState>) => setFormData({ ...formData, ...updates });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const result = user
        ? await apiClient.put(`/api/users/${user.id}`, formData)
        : await apiClient.post('/api/users', {
            ...formData,
            contestId: formData.contestId ? Number(formData.contestId) : undefined,
            teamCode: formData.teamCode || undefined,
          });

      if (result.success) {
        addToast({
          type: 'success',
          title: user ? 'User updated' : 'User created',
          message: formData.password
            ? `${formData.username} saved — new password is active immediately.`
            : `${formData.username} saved.`,
        });
        onSuccess();
        onClose();
      } else {
        const msg = result.error || 'Operation failed';
        setError(msg);
        addToast({ type: 'error', title: 'Save failed', message: msg });
      }
    } catch {
      setError('An unexpected error occurred');
      addToast({ type: 'error', title: 'Save failed', message: 'An unexpected error occurred' });
    } finally {
      setLoading(false);
    }
  };

  const inputClassName = 'w-full px-3 py-2 bg-black/80 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all';

  return (
    <Portal>
      <div className="fixed inset-0 z-100 flex items-center justify-center overflow-hidden bg-black/80 backdrop-blur-sm p-4">
        <Card className="w-full max-w-md p-6 relative animate-in fade-in zoom-in-95 duration-200 bg-neutral-900/80 border-white/10 shadow-2xl">
          <button
            onClick={onClose}
            title="Close"
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

          {/* FORM */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-neutral-400 uppercase tracking-wider">First Name</label>
                <input
                  required
                  type="text"
                  value={formData.first_name}
                  onChange={(e) => updateForm({ first_name: e.target.value })}
                  className={cn(inputClassName, 'font-sans')}
                  placeholder="John"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-neutral-400 uppercase tracking-wider">Last Name</label>
                <input
                  required
                  type="text"
                  value={formData.last_name}
                  onChange={(e) => updateForm({ last_name: e.target.value })}
                  className={cn(inputClassName, 'font-sans')}
                  placeholder="Doe"
                />
              </div>
            </div>

            {/* ACCOUNT */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-neutral-400 uppercase tracking-wider">Username</label>
              <input
                required
                type="text"
                value={formData.username}
                onChange={(e) => updateForm({ username: e.target.value })}
                className={cn(inputClassName, 'font-mono')}
                placeholder="johndoe"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-neutral-400 uppercase tracking-wider">Email (Optional)</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => updateForm({ email: e.target.value })}
                className={cn(inputClassName, 'font-sans')}
                placeholder="john@example.com"
              />
            </div>

            <div className="space-y-1.5">
              <PasswordFieldWithGenerator
                label={user ? 'New Password (Optional)' : 'Password'}
                value={formData.password}
                onChange={(password) => updateForm({ password })}
                required={!user}
                placeholder="••••••••"
              />
            </div>

            {/* PREFERENCES */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-neutral-400 uppercase tracking-wider">Timezone</label>
              <input
                type="text"
                value={formData.timezone}
                onChange={(e) => updateForm({ timezone: e.target.value })}
                className={inputClassName}
                placeholder="Asia/Bangkok"
              />
            </div>

            {/* ENROLLMENT */}
            {!user && (
              <>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-neutral-400 uppercase tracking-wider">Contest (Optional)</label>
                  <select
                    value={formData.contestId}
                    onChange={(e) => updateForm({ contestId: e.target.value })}
                    className={inputClassName}
                    title="Contest"
                  >
                    <option value="">No contest</option>
                    {contests.map((contest) => (
                      <option key={contest.id} value={contest.id}>#{contest.id} - {contest.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-neutral-400 uppercase tracking-wider">Team Code (Optional)</label>
                  <input
                    type="text"
                    value={formData.teamCode}
                    onChange={(e) => updateForm({ teamCode: e.target.value })}
                    className={cn(inputClassName, 'font-mono')}
                    placeholder="TEAM_A"
                  />
                  <p className="text-[11px] text-neutral-500">If team code is set, contest must be selected.</p>
                </div>
              </>
            )}

            {/* FOOTER */}
            <div className="pt-6 flex justify-end gap-3">
              <Button
                type="button"
                variant="ghost"
                onClick={onClose}
                disabled={loading}
                className="text-neutral-400 hover:text-white"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                className="bg-linear-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white shadow-lg shadow-indigo-500/20 px-6"
                disabled={loading}
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : (user ? 'Save Changes' : 'Create User')}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </Portal>
  );
}
