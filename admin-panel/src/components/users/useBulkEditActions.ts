'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/lib/apiClient';
import { getTeams } from '@/app/actions/teams';
import type { PasswordKind } from '@/lib/password-format';
import { makePassword, makeUsername } from './csvPreview';
import { submitCredentialUpdates, type BatchActionResult } from './bulkEditActions';
import type { ContestOption, SelectedUser } from './bulkEditActions';

const DEFAULT_TIMEZONE = 'Asia/Bangkok';

interface BulkEditActionsOptions {
  selectedUsers: SelectedUser[];
  contests: ContestOption[];
  onSuccess: () => void;
  onClose: () => void;
}

/** Owns all bulk-edit mutation state and server actions for the dialog; render stays dumb. */
export function useBulkEditActions({ selectedUsers, contests, onSuccess, onClose }: BulkEditActionsOptions) {
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [selectedContestId, setSelectedContestId] = useState<number>(contests[0]?.id ?? 0);
  const [teamContestId, setTeamContestId] = useState<number>(contests[0]?.id ?? 0);
  const [teamCode, setTeamCode] = useState('');
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [emailDomain, setEmailDomain] = useState('');
  const [passwordKind, setPasswordKind] = useState<PasswordKind>('bcrypt');
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

  const selectedUserIds = useMemo(() => rows.map((row) => row.id), [rows]);

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
    options: { applyLocal?: (currentRows: SelectedUser[]) => SelectedUser[]; fallbackError?: string } = {}
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

  const exportSelectedRows = (filename: string, buildCsv: (rows: SelectedUser[]) => string): void => {
    if (rows.length === 0) return;
    openCsvDownload(buildCsv(rows), filename);
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

  const applyCredentials = (closeAfter: boolean): Promise<void> =>
    submitCredentialUpdates(rows, closeAfter, onClose, onSuccess, { setLoading, setErrorMessage, setStatusMessage }, passwordKind);

  return {
    loading, statusMessage, errorMessage,
    selectedContestId, setSelectedContestId,
    teamContestId, setTeamContestId,
    teamCode, setTeamCode,
    timezone, setTimezone,
    emailDomain, setEmailDomain,
    passwordKind, setPasswordKind,
    rows, teamsOptions,
    runRegenerate, exportSelectedRows,
    runContestMutation, runTeamSet, runTeamRemoveAny,
    runTimezoneUpdate, runEmailDomainUpdate, runEmailClear,
    applyCredentials,
  };
}

function openCsvDownload(content: string, filename: string): void {
  const bom = '\uFEFF';
  const blob = new Blob([bom + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.setAttribute('download', filename);
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
