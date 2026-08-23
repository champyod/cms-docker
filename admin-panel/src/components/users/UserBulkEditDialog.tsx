'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Wand2, X } from 'lucide-react';
import { Button } from '@/components/core/Button';
import { apiClient } from '@/lib/apiClient';
import { getTeams } from '@/app/actions/teams';
import { Portal } from '@/components/core/Portal';
import { makePassword, makeUsername } from './csvPreview';
import { BulkEditPreviewTable, ContestSection, ProfileSection, TeamSection } from './bulkEditSections';
import { buildEditExportCsv, downloadTextFile, type ContestOption, type SelectedUser } from './bulkEditActions';

const DEFAULT_TIMEZONE = 'Asia/Bangkok';

interface BatchActionResult {
  success?: boolean;
  error?: string;
  addedCount?: number;
  removedCount?: number;
  updatedCount?: number;
  count?: number;
  downloadUrl?: string;
}

interface UserBulkEditDialogProps {
  isOpen: boolean;
  onClose: () => void;
  selectedUsers: SelectedUser[];
  contests: ContestOption[];
  onSuccess: () => void;
}

export function UserBulkEditDialog({ isOpen, onClose, selectedUsers, contests, onSuccess }: UserBulkEditDialogProps) {
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [selectedContestId, setSelectedContestId] = useState<number>(contests[0]?.id ?? 0);
  const [teamContestId, setTeamContestId] = useState<number>(contests[0]?.id ?? 0);
  const [teamCode, setTeamCode] = useState('');
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [emailDomain, setEmailDomain] = useState('');
  const [rows, setRows] = useState(selectedUsers);
  const [teamsOptions, setTeamsOptions] = useState<string[]>([]);

  useEffect(() => {
    // Stored password hashes must never reach the editable preview — only locally generated plaintext appears here.
    setRows(selectedUsers.map((u) => ({ ...u, password: null })));
  }, [selectedUsers]);

  useEffect(() => {
    if (contests.length > 0 && !contests.find((contest) => contest.id === selectedContestId)) {
      setSelectedContestId(contests[0].id);
    }
  }, [contests, selectedContestId]);

  useEffect(() => {
    if (contests.length > 0 && !contests.find((contest) => contest.id === teamContestId)) {
      setTeamContestId(contests[0].id);
    }
  }, [contests, teamContestId]);

  useEffect(() => {
    const fetchTeams = async (): Promise<void> => {
      if (!teamContestId) {
        setTeamsOptions([]);
        return;
      }
      try {
        const teams = await getTeams();
        setTeamsOptions(teams.map((t: { code: string }) => t.code).filter(Boolean));
      } catch {
        setTeamsOptions([]);
      }
    };

    fetchTeams();
  }, [teamContestId]);

  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  const selectedUserIds = useMemo(() => rows.map((row) => row.id), [rows]);

  if (!isOpen) return null;

  const requireValue = (value: string, label: string): boolean => {
    if (!value.trim()) {
      setErrorMessage(`${label} is required`);
      return false;
    }
    return true;
  };

  const runBatchAction = async (
    payload: Record<string, unknown>,
    buildStatus: (result: BatchActionResult) => string,
    options: { applyLocal?: (rows: SelectedUser[]) => SelectedUser[]; fallbackError?: string } = {}
  ): Promise<void> => {
    setLoading(true);
    setErrorMessage('');
    setStatusMessage('');

    const result = await apiClient.post('/api/users/batch', payload) as BatchActionResult;

    if (!result.success) {
      setErrorMessage(result.error || options.fallbackError || 'Failed to update users');
      setLoading(false);
      return;
    }

    if (options.applyLocal) {
      setRows(options.applyLocal);
    }

    setStatusMessage(buildStatus(result));
    setLoading(false);
    onSuccess();
  };

  const runRegenerate = (mode: 'username' | 'password'): void => {
    if (selectedUserIds.length === 0) return;

    // Local-only preview regeneration — nothing reaches the server until Apply Credentials.
    setLoading(true);
    setErrorMessage('');
    setStatusMessage('');

    const used = new Set<string>();

    setRows((prev) =>
      prev.map((user) => {
        if (!selectedUserIds.includes(user.id)) return user;
        const next = { ...user };
        if (mode === 'username') {
          next.username = makeUsername(next.first_name || '', next.last_name || '', used);
        }
        if (mode === 'password') {
          next.password = makePassword();
        }
        return next;
      })
    );

    setStatusMessage(`Locally regenerated ${mode} for ${selectedUserIds.length} user(s)`);
    setLoading(false);
    // No onSuccess() — the preview must keep generated values for export or explicit apply.
  };

  const handleExportSelectedRows = (): void => {
    if (rows.length === 0) return;
    downloadTextFile(buildEditExportCsv(rows), `users-selected-${Date.now()}.csv`);
  };

  const runContestMutation = (mode: 'add' | 'remove'): void => {
    if (selectedUserIds.length === 0 || !selectedContestId) return;
    void runBatchAction(
      { action: 'contest', mode, contestId: selectedContestId, userIds: selectedUserIds },
      (result) => {
        const contestName = contests.find((contest) => contest.id === selectedContestId)?.name || `#${selectedContestId}`;
        return mode === 'add'
          ? `Added ${result.addedCount ?? 0} user(s) to contest ${contestName}`
          : `Removed ${result.removedCount ?? 0} user(s) from contest ${contestName}`;
      },
      { fallbackError: 'Failed to update contest participation' }
    );
  };

  const runTeamSet = (): void => {
    if (selectedUserIds.length === 0 || !teamContestId) return;
    if (!requireValue(teamCode, 'Team code')) return;
    void runBatchAction(
      { action: 'team', mode: 'set', contestId: teamContestId, teamCode: teamCode.trim(), userIds: selectedUserIds },
      (result) => {
        const contestName = contests.find((c) => c.id === teamContestId)?.name || `#${teamContestId}`;
        return `Assigned team ${teamCode.trim()} for ${result.updatedCount ?? 0} user(s) in contest ${contestName}`;
      },
      { fallbackError: 'Failed to set team' }
    );
  };

  const runTeamRemoveAny = (): void => {
    if (selectedUserIds.length === 0) return;
    void runBatchAction(
      { action: 'team', mode: 'remove-any', userIds: selectedUserIds },
      (result) => `Removed team from ${result.updatedCount ?? 0} participation(s)`,
      { fallbackError: 'Failed to remove teams' }
    );
  };

  const runTimezoneUpdate = (): void => {
    if (selectedUserIds.length === 0) return;
    if (!requireValue(timezone, 'Timezone')) return;
    void runBatchAction(
      { action: 'profile', mode: 'timezone', timezone: timezone.trim(), userIds: selectedUserIds },
      (result) => `Updated timezone for ${result.updatedCount ?? 0} user(s)`,
      { fallbackError: 'Failed to update timezone' }
    );
  };

  const runEmailDomainUpdate = (): void => {
    if (selectedUserIds.length === 0) return;
    if (!requireValue(emailDomain, 'Email domain')) return;
    void runBatchAction(
      { action: 'profile', mode: 'email-domain', emailDomain: emailDomain.trim(), userIds: selectedUserIds },
      (result) => `Updated email domain for ${result.updatedCount ?? 0} user(s)`,
      {
        fallbackError: 'Failed to update email domain',
        applyLocal: (prev) => prev.map((user) => {
          const localPart = (user.email?.split('@')[0] || user.username).trim();
          return { ...user, email: `${localPart}@${emailDomain.trim().toLowerCase()}` };
        }),
      }
    );
  };

  const runEmailClear = (): void => {
    if (selectedUserIds.length === 0) return;
    void runBatchAction(
      { action: 'profile', mode: 'clear-email', userIds: selectedUserIds },
      (result) => `Cleared email for ${result.updatedCount ?? 0} user(s)`,
      {
        fallbackError: 'Failed to clear emails',
        applyLocal: (prev) => prev.map((user) => ({ ...user, email: null })),
      }
    );
  };

  const collectCredentialUpdates = () =>
    rows
      .filter((r) => r.password || r.username)
      .map((r) => ({ id: r.id, username: r.username, password: r.password }));

  const openServerDownload = (downloadUrl: string): void => {
    const anchor = document.createElement('a');
    anchor.href = downloadUrl;
    anchor.setAttribute('download', `users-applied-${Date.now()}.csv`);
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  };

  const applyCredentials = async (closeAfter: boolean): Promise<void> => {
    const updates = collectCredentialUpdates();

    if (updates.length === 0) {
      if (closeAfter) {
        onClose();
        return;
      }
      setErrorMessage('No generated credentials to apply');
      return;
    }

    setLoading(true);
    setErrorMessage('');
    setStatusMessage('');

    try {
      const result = await apiClient.post('/api/users/batch', { action: 'apply-credentials', updates }) as BatchActionResult;

      if (!result.success) {
        setErrorMessage(result.error || 'Failed to apply credentials');
        setLoading(false);
        return;
      }

      const count = typeof result.count === 'number' ? result.count : updates.length;
      if (result.downloadUrl) {
        openServerDownload(result.downloadUrl);
      }

      setStatusMessage(closeAfter ? `Applied and exported ${count} credential(s)` : `Applied credentials for ${count} user(s)`);
      setLoading(false);
      onSuccess();
      if (closeAfter) onClose();
    } catch (e) {
      setErrorMessage((e as Error)?.message || 'Network error');
      setLoading(false);
    }
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-100 flex items-center justify-center overflow-hidden bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
        <div className="relative z-10 w-full max-w-6xl max-h-[90vh] bg-neutral-900 border border-white/10 rounded-xl shadow-2xl flex flex-col" onClick={(event) => event.stopPropagation()}>
          <div className="flex items-center justify-between p-4 border-b border-white/10">
            <h2 className="text-xl font-bold text-white">Edit Selected Users</h2>
            <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg transition-colors" title="Close" aria-label="Close">
              <X className="w-5 h-5 text-neutral-400" />
            </button>
          </div>

          {/* CONTROLS */}
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
              <Button variant="ghost" onClick={handleExportSelectedRows} disabled={rows.length === 0}>
                <Wand2 className="w-4 h-4 mr-2" /> Export Current Preview
              </Button>
            </div>

            <ContestSection
              contests={contests}
              selectedContestId={selectedContestId}
              loading={loading}
              hasRows={rows.length > 0}
              onContestIdChange={setSelectedContestId}
              onRunContestMutation={runContestMutation}
            />

            <TeamSection
              contests={contests}
              teamContestId={teamContestId}
              teamCode={teamCode}
              teamsOptions={teamsOptions}
              loading={loading}
              hasRows={rows.length > 0}
              onTeamContestIdChange={setTeamContestId}
              onTeamCodeChange={setTeamCode}
              onRunTeamSet={runTeamSet}
              onRunTeamRemoveAny={runTeamRemoveAny}
            />

            <ProfileSection
              timezone={timezone}
              emailDomain={emailDomain}
              loading={loading}
              hasRows={rows.length > 0}
              onTimezoneChange={setTimezone}
              onEmailDomainChange={setEmailDomain}
              onRunTimezoneUpdate={runTimezoneUpdate}
              onRunEmailDomainUpdate={runEmailDomainUpdate}
              onRunEmailClear={runEmailClear}
            />

            {statusMessage && <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300">{statusMessage}</div>}
            {errorMessage && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{errorMessage}</div>}

            <BulkEditPreviewTable rows={rows} />

            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => applyCredentials(false)} disabled={loading || rows.length === 0}>
                Apply Credentials
              </Button>
            </div>
          </div>

          {/* FOOTER */}
          <div className="p-4 border-t border-white/10 flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => applyCredentials(true)}
              disabled={loading}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Done'}
            </Button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
