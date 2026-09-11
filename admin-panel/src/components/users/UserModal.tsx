'use client';

import { useState, useEffect, useMemo } from 'react';

import { revealUserPassword } from '@/app/actions/users';
import { Button } from '@/components/core/Button';
import { Dialog, DialogFooter } from '@/components/core/Dialog';
import { PasswordFieldWithKind, type PasswordRevealState } from '@/components/core/PasswordFieldWithKind';
import { RestrictedField } from '@/components/core/RestrictedField';
import { useToast } from '@/components/providers/ToastProvider';
import { apiClient } from '@/lib/apiClient';
import { getFieldAccess, stripDisallowedFields } from '@/lib/field-permissions';
import { cn } from '@/lib/utils';
import type { PasswordKind } from '@/lib/password-format';
import type { UsersPageRow } from '@/lib/prisma-selects';

import { EMPTY_USER_FORM, formFromUser, type UserFormState } from './userFormState';

interface UserModalProps {
  isOpen: boolean;
  onClose: () => void;
  user?: UsersPageRow | null;
  contests?: Array<{ id: number; name: string }>;
  onSuccess: () => void;
  permissionKeys: readonly string[];
}

export function UserModal({ isOpen, onClose, user, contests = [], onSuccess, permissionKeys }: UserModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { addToast } = useToast();
  const [formData, setFormData] = useState<UserFormState>(EMPTY_USER_FORM);
  const [passwordKind, setPasswordKind] = useState<PasswordKind>('bcrypt');
  const [reveal, setReveal] = useState<PasswordRevealState>({ state: 'none' });

  const effective = useMemo(() => new Set(permissionKeys), [permissionKeys]);
  const fieldAccess = useMemo(() => getFieldAccess('users', effective), [effective]);

  useEffect(() => {
    setFormData(user ? formFromUser(user) : EMPTY_USER_FORM);
    setPasswordKind('bcrypt');
    setReveal({ state: 'none' });
    if (!user || !isOpen) return;

    let cancelled = false;
    void (async () => {
      try {
        const result = await revealUserPassword(user.id);
        if (cancelled || !result.success) return;
        setReveal(
          result.kind === 'plaintext'
            ? { state: 'plaintext', value: result.value }
            : { state: 'bcrypt' }
        );
      } catch {
        if (!cancelled) setReveal({ state: 'none' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, isOpen]);

  const updateForm = (updates: Partial<UserFormState>) => setFormData({ ...formData, ...updates });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const allowed = stripDisallowedFields('users', formData as unknown as Record<string, unknown>, effective);
      const payload: Record<string, unknown> = { ...allowed };
      if (payload.password === '') delete payload.password;
      if (!payload.password) delete payload.password;
      payload.passwordKind = passwordKind;

      const result = user
        ? await apiClient.put(`/api/users/${user.id}`, payload)
        : await apiClient.post('/api/users', {
            ...payload,
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

  const inputClassName = 'w-full px-3 py-2 bg-background/60 border border-border rounded-lg text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/30 transition-colors';

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={user ? 'Edit User' : 'Create New User'}
      className="sm:max-w-md"
    >
      {error && (
        <div className="mb-4 p-3 border border-destructive/30 bg-destructive/10 rounded-lg text-destructive text-sm">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <RestrictedField
            canRead={fieldAccess.first_name.canRead}
            canUpdate={fieldAccess.first_name.canUpdate}
            label="First Name"
            lockHint="Read-only — you lack user:update"
          >
            <input
              required
              type="text"
              value={formData.first_name}
              onChange={(e) => updateForm({ first_name: e.target.value })}
              className={cn(inputClassName, 'font-sans')}
              placeholder="John"
            />
          </RestrictedField>
          <RestrictedField
            canRead={fieldAccess.last_name.canRead}
            canUpdate={fieldAccess.last_name.canUpdate}
            label="Last Name"
            lockHint="Read-only — you lack user:update"
          >
            <input
              required
              type="text"
              value={formData.last_name}
              onChange={(e) => updateForm({ last_name: e.target.value })}
              className={cn(inputClassName, 'font-sans')}
              placeholder="Doe"
            />
          </RestrictedField>
        </div>
        <RestrictedField
          canRead={fieldAccess.username.canRead}
          canUpdate={fieldAccess.username.canUpdate}
          label="Username"
          lockHint="Read-only — you lack user:update"
        >
          <input
            required
            type="text"
            value={formData.username}
            onChange={(e) => updateForm({ username: e.target.value })}
            className={cn(inputClassName, 'font-mono')}
            placeholder="johndoe"
          />
        </RestrictedField>

        <RestrictedField
          canRead={fieldAccess.email.canRead}
          canUpdate={fieldAccess.email.canUpdate}
          label="Email (Optional)"
          lockHint="Read-only — you lack user:update"
        >
          <input
            type="email"
            value={formData.email}
            onChange={(e) => updateForm({ email: e.target.value })}
            className={cn(inputClassName, 'font-sans')}
            placeholder="john@example.com"
          />
        </RestrictedField>

        <RestrictedField
          canRead={fieldAccess.password.canRead}
          canUpdate={fieldAccess.password.canUpdate}
          label={user ? 'New Password (Optional)' : 'Password'}
          lockHint="Read-only — you lack user:update"
        >
          <PasswordFieldWithKind
            label=""
            value={formData.password}
            onChange={(password) => updateForm({ password })}
            required={!user}
            placeholder="••••••••"
            kind={passwordKind}
            onKind={setPasswordKind}
            reveal={{ ...reveal, onReveal: () => undefined }}
          />
        </RestrictedField>
        <RestrictedField
          canRead={fieldAccess.timezone.canRead}
          canUpdate={fieldAccess.timezone.canUpdate}
          label="Timezone"
          lockHint="Read-only — you lack user:update"
        >
          <input
            type="text"
            value={formData.timezone}
            onChange={(e) => updateForm({ timezone: e.target.value })}
            className={inputClassName}
            placeholder="Asia/Bangkok"
          />
        </RestrictedField>
        {!user && (
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Contest (Optional)</label>
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
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Team Code (Optional)</label>
              <input
                type="text"
                value={formData.teamCode}
                onChange={(e) => updateForm({ teamCode: e.target.value })}
                className={cn(inputClassName, 'font-mono')}
                placeholder="TEAM_A"
              />
              <p className="text-xs text-muted-foreground">If team code is set, contest must be selected.</p>
            </div>
          </>
        )}
        <DialogFooter className="pt-6">
          <Button
            variant="negativeOutline"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="positive"
            loading={loading}
            disabled={loading}
          >
            {user ? 'Save Changes' : 'Create User'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
