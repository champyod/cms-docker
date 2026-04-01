'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Wand2, X } from 'lucide-react';
import { Button } from '@/components/core/Button';
import { apiClient } from '@/lib/apiClient';

interface ContestOption {
  id: number;
  name: string;
}

interface SelectedUser {
  id: number;
  first_name: string;
  last_name: string;
  username: string;
  email?: string | null;
}

interface UserBulkEditDialogProps {
  isOpen: boolean;
  onClose: () => void;
  selectedUsers: SelectedUser[];
  contests: ContestOption[];
  onSuccess: () => void;
}

export function UserBulkEditDialog({ isOpen, onClose, selectedUsers, contests, onSuccess }: UserBulkEditDialogProps) {
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [selectedContestId, setSelectedContestId] = useState<number>(contests[0]?.id ?? 0);
  const [teamCode, setTeamCode] = useState('');
  const [timezone, setTimezone] = useState('Asia/Bangkok');
  const [emailDomain, setEmailDomain] = useState('');
  const [rows, setRows] = useState(selectedUsers);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setRows(selectedUsers);
  }, [selectedUsers]);

  useEffect(() => {
    if (contests.length > 0 && !contests.find((contest) => contest.id === selectedContestId)) {
      setSelectedContestId(contests[0].id);
    }
  }, [contests, selectedContestId]);

  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  const selectedUserIds = useMemo(() => rows.map((row) => row.id), [rows]);

  if (!isOpen || !mounted) return null;

  const runRegenerate = async (mode: 'username' | 'password') => {
    if (selectedUserIds.length === 0) return;

    setLoading(true);
    setErrorMessage('');
    setStatusMessage('');

    const result = await apiClient.post('/api/users/batch', {
      action: 'regenerate',
      mode,
      userIds: selectedUserIds,
    });

    if (!result.success) {
      setErrorMessage(result.error || 'Failed to regenerate credentials');
      setLoading(false);
      return;
    }

    const updatedById = new Map<number, { username?: string; password?: string }>();
    (result.updated || []).forEach((row: { id: number; username?: string; password?: string }) => {
      updatedById.set(row.id, row);
    });

    setRows((prev) =>
      prev.map((user) => {
        const updated = updatedById.get(user.id);
        if (!updated) return user;
        return {
          ...user,
          username: updated.username ?? user.username,
        };
      })
    );

    setStatusMessage(`Regenerated ${mode} for ${selectedUserIds.length} user(s)`);
    setLoading(false);
    onSuccess();
  };

  const runContestMutation = async (mode: 'add' | 'remove') => {
    if (selectedUserIds.length === 0 || !selectedContestId) return;

    setLoading(true);
    setErrorMessage('');
    setStatusMessage('');

    const result = await apiClient.post('/api/users/batch', {
      action: 'contest',
      mode,
      contestId: selectedContestId,
      userIds: selectedUserIds,
    });

    if (!result.success) {
      setErrorMessage(result.error || 'Failed to update contest participation');
      setLoading(false);
      return;
    }

    const contestName = contests.find((contest) => contest.id === selectedContestId)?.name || `#${selectedContestId}`;
    if (mode === 'add') {
      setStatusMessage(`Added ${result.addedCount ?? 0} user(s) to contest ${contestName}`);
    } else {
      setStatusMessage(`Removed ${result.removedCount ?? 0} user(s) from contest ${contestName}`);
    }

    setLoading(false);
    onSuccess();
  };

  const runTeamSet = async () => {
    if (selectedUserIds.length === 0 || !selectedContestId) return;
    if (!teamCode.trim()) {
      setErrorMessage('Team code is required');
      return;
    }

    setLoading(true);
    setErrorMessage('');
    setStatusMessage('');

    const result = await apiClient.post('/api/users/batch', {
      action: 'team',
      mode: 'set',
      contestId: selectedContestId,
      teamCode: teamCode.trim(),
      userIds: selectedUserIds,
    });

    if (!result.success) {
      setErrorMessage(result.error || 'Failed to set team');
      setLoading(false);
      return;
    }

    setStatusMessage(`Assigned team ${teamCode.trim()} for ${result.updatedCount ?? 0} user(s)`);
    setLoading(false);
    onSuccess();
  };

  const runTeamRemoveAny = async () => {
    if (selectedUserIds.length === 0) return;

    setLoading(true);
    setErrorMessage('');
    setStatusMessage('');

    const result = await apiClient.post('/api/users/batch', {
      action: 'team',
      mode: 'remove-any',
      userIds: selectedUserIds,
    });

    if (!result.success) {
      setErrorMessage(result.error || 'Failed to remove teams');
      setLoading(false);
      return;
    }

    setStatusMessage(`Removed team from ${result.updatedCount ?? 0} participation(s)`);
    setLoading(false);
    onSuccess();
  };

  const runTimezoneUpdate = async () => {
    if (selectedUserIds.length === 0) return;
    if (!timezone.trim()) {
      setErrorMessage('Timezone is required');
      return;
    }

    setLoading(true);
    setErrorMessage('');
    setStatusMessage('');

    const result = await apiClient.post('/api/users/batch', {
      action: 'profile',
      mode: 'timezone',
      timezone: timezone.trim(),
      userIds: selectedUserIds,
    });

    if (!result.success) {
      setErrorMessage(result.error || 'Failed to update timezone');
      setLoading(false);
      return;
    }

    setStatusMessage(`Updated timezone for ${result.updatedCount ?? 0} user(s)`);
    setLoading(false);
    onSuccess();
  };

  const runEmailDomainUpdate = async () => {
    if (selectedUserIds.length === 0) return;
    if (!emailDomain.trim()) {
      setErrorMessage('Email domain is required');
      return;
    }

    setLoading(true);
    setErrorMessage('');
    setStatusMessage('');

    const result = await apiClient.post('/api/users/batch', {
      action: 'profile',
      mode: 'email-domain',
      emailDomain: emailDomain.trim(),
      userIds: selectedUserIds,
    });

    if (!result.success) {
      setErrorMessage(result.error || 'Failed to update email domain');
      setLoading(false);
      return;
    }

    setRows((prev) =>
      prev.map((user) => {
        const localPart = (user.email?.split('@')[0] || user.username).trim();
        return { ...user, email: `${localPart}@${emailDomain.trim().toLowerCase()}` };
      })
    );

    setStatusMessage(`Updated email domain for ${result.updatedCount ?? 0} user(s)`);
    setLoading(false);
    onSuccess();
  };

  const runEmailClear = async () => {
    if (selectedUserIds.length === 0) return;

    setLoading(true);
    setErrorMessage('');
    setStatusMessage('');

    const result = await apiClient.post('/api/users/batch', {
      action: 'profile',
      mode: 'clear-email',
      userIds: selectedUserIds,
    });

    if (!result.success) {
      setErrorMessage(result.error || 'Failed to clear emails');
      setLoading(false);
      return;
    }

    setRows((prev) => prev.map((user) => ({ ...user, email: null })));
    setStatusMessage(`Cleared email for ${result.updatedCount ?? 0} user(s)`);
    setLoading(false);
    onSuccess();
  };

  return createPortal(
    <div className="fixed inset-0 z-100 flex items-center justify-center overflow-hidden bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="relative z-10 w-full max-w-6xl max-h-[90vh] bg-neutral-900 border border-white/10 rounded-xl shadow-2xl flex flex-col" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <h2 className="text-xl font-bold text-white">Edit Selected Users</h2>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg transition-colors" title="Close" aria-label="Close">
            <X className="w-5 h-5 text-neutral-400" />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-auto">
          <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-neutral-300">
            Selected: {rows.length} user(s)
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => runRegenerate('username')} disabled={loading || rows.length === 0}>
              <Wand2 className="w-4 h-4 mr-2" /> Regenerate Username
            </Button>
            <Button variant="ghost" onClick={() => runRegenerate('password')} disabled={loading || rows.length === 0}>
              <Wand2 className="w-4 h-4 mr-2" /> Regenerate Password
            </Button>
          </div>

          <div className="rounded-lg border border-white/10 bg-black/20 p-3 space-y-3">
            <div className="text-xs text-neutral-300">Contest membership</div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedContestId}
                title="Select contest"
                onChange={(event) => setSelectedContestId(Number(event.target.value) || 0)}
                className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
              >
                {contests.map((contest) => (
                  <option key={contest.id} value={contest.id}>
                    #{contest.id} - {contest.name}
                  </option>
                ))}
              </select>
              <Button variant="ghost" onClick={() => runContestMutation('add')} disabled={loading || rows.length === 0 || !selectedContestId}>
                Add to contest
              </Button>
              <Button variant="ghost" onClick={() => runContestMutation('remove')} disabled={loading || rows.length === 0 || !selectedContestId}>
                Remove from contest
              </Button>
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-black/20 p-3 space-y-3">
            <div className="text-xs text-neutral-300">Team assignment</div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedContestId}
                title="Select contest for team"
                onChange={(event) => setSelectedContestId(Number(event.target.value) || 0)}
                className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
              >
                {contests.map((contest) => (
                  <option key={contest.id} value={contest.id}>
                    #{contest.id} - {contest.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={teamCode}
                onChange={(event) => setTeamCode(event.target.value)}
                placeholder="Team code"
                title="Team code"
                className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono"
              />
              <Button variant="ghost" onClick={runTeamSet} disabled={loading || rows.length === 0 || !selectedContestId}>
                Add to team
              </Button>
              <Button variant="ghost" onClick={runTeamRemoveAny} disabled={loading || rows.length === 0}>
                Remove from any team
              </Button>
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-black/20 p-3 space-y-3">
            <div className="text-xs text-neutral-300">Profile fields</div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                placeholder="Timezone"
                title="Timezone"
                className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
              />
              <Button variant="ghost" onClick={runTimezoneUpdate} disabled={loading || rows.length === 0}>
                Update timezone
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={emailDomain}
                onChange={(event) => setEmailDomain(event.target.value)}
                placeholder="example.com"
                title="Email domain"
                className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
              />
              <Button variant="ghost" onClick={runEmailDomainUpdate} disabled={loading || rows.length === 0}>
                Set email domain
              </Button>
              <Button variant="ghost" onClick={runEmailClear} disabled={loading || rows.length === 0}>
                Reset email
              </Button>
            </div>
          </div>

          {statusMessage && <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300">{statusMessage}</div>}
          {errorMessage && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{errorMessage}</div>}

          <div className="border border-white/10 rounded-lg overflow-hidden">
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-white/5 text-neutral-300 sticky top-0 z-10">
                  <tr>
                    <th className="text-left px-2 py-2">ID</th>
                    <th className="text-left px-2 py-2">first_name</th>
                    <th className="text-left px-2 py-2">last_name</th>
                    <th className="text-left px-2 py-2">username</th>
                    <th className="text-left px-2 py-2">email</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-neutral-500">
                        No selected users
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => (
                      <tr key={row.id} className="border-t border-white/5">
                        <td className="px-2 py-2 text-neutral-400">#{row.id}</td>
                        <td className="px-2 py-2 text-white">{row.first_name}</td>
                        <td className="px-2 py-2 text-white">{row.last_name}</td>
                        <td className="px-2 py-2 text-white">{row.username}</td>
                        <td className="px-2 py-2 text-white">{row.email || '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-white/10 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onClose} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Done'}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
