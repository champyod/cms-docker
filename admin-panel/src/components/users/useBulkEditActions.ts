'use client';

import { useEffect, useMemo, useState } from 'react';

import { getTeams } from '@/app/actions/teams';
import type { PasswordKind } from '@/lib/password-format';
import { submitCredentialUpdates } from './bulkEditActions';
import type { ContestOption, SelectedUser } from './bulkEditActions';
import { makePassword, makeUsername } from './csvPreview';
import { useBulkReveal } from './useBulkReveal';
import { useBulkBatch } from './useBulkBatch';

const DEFAULT_TIMEZONE = 'Asia/Bangkok';

interface BulkEditActionsOptions {
  selectedUsers: SelectedUser[];
  contests: ContestOption[];
  onSuccess: () => void;
  onClose: () => void;
}

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

  const { revealedIds, revealingIds, allRevealed, revealRowPassword, toggleAllRevealed } = useBulkReveal(rows, setRows);

  useEffect(() => {
    setRows(selectedUsers.map((user) => ({ ...user, password: null })));
  }, [selectedUsers]);

  useEffect(() => {
    if (contests.length > 0 && !contests.find((contest) => contest.id === selectedContestId)) setSelectedContestId(contests[0].id);
  }, [contests, selectedContestId]);

  useEffect(() => {
    if (contests.length > 0 && !contests.find((contest) => contest.id === teamContestId)) setTeamContestId(contests[0].id);
  }, [contests, teamContestId]);

  useEffect(() => {
    const fetchTeams = async (): Promise<void> => {
      if (!teamContestId) {
        setTeamsOptions([]);
        return;
      }
      try {
        const teams = await getTeams();
        setTeamsOptions(teams.map((team: { code: string }) => team.code).filter(Boolean));
      } catch {
        setTeamsOptions([]);
      }
    };
    void fetchTeams();
  }, [teamContestId]);

  const selectedUserIds = useMemo(() => rows.map((row) => row.id), [rows]);

  const batch = useBulkBatch({
    rows,
    setRows,
    selectedUserIds,
    contests,
    selectedContestId,
    teamContestId,
    teamCode,
    timezone,
    emailDomain,
    setLoading,
    setStatusMessage,
    setErrorMessage,
    onSuccess,
  });

  const runRegenerate = (mode: 'username' | 'password'): void => {
    if (selectedUserIds.length === 0) return;
    setLoading(true);
    setErrorMessage('');
    setStatusMessage('');
    const used = new Set<string>();
    setRows((previous) =>
      previous.map((user) => {
        if (!selectedUserIds.includes(user.id)) return user;
        const next = { ...user };
        if (mode === 'username') next.username = makeUsername(next.first_name || '', next.last_name || '', used);
        if (mode === 'password') next.password = makePassword();
        return next;
      })
    );
    setStatusMessage(`Locally regenerated ${mode} for ${selectedUserIds.length} user(s)`);
    setLoading(false);
  };

  const exportSelectedRows = (filename: string, buildCsv: (rows: SelectedUser[]) => string): void => {
    if (rows.length === 0) return;
    openCsvDownload(buildCsv(rows), filename);
  };

  const applyCredentials = (closeAfter: boolean): Promise<void> =>
    submitCredentialUpdates(rows, closeAfter, onClose, onSuccess, { setLoading, setErrorMessage, setStatusMessage }, passwordKind);

  return {
    loading,
    statusMessage,
    errorMessage,
    selectedContestId,
    setSelectedContestId,
    teamContestId,
    setTeamContestId,
    teamCode,
    setTeamCode,
    timezone,
    setTimezone,
    emailDomain,
    setEmailDomain,
    passwordKind,
    setPasswordKind,
    rows,
    teamsOptions,
    revealedIds,
    revealingIds,
    allRevealed,
    revealRowPassword,
    toggleAllRevealed,
    runRegenerate,
    exportSelectedRows,
    applyCredentials,
    selectedUserIds,
    setRows,
    setLoading,
    setStatusMessage,
    setErrorMessage,
    exportCurrentPasswords: batch.exportCurrentPasswords,
    runContestMutation: batch.runContestMutation,
    runTeamSet: batch.runTeamSet,
    runTeamRemoveAny: batch.runTeamRemoveAny,
    runTimezoneUpdate: batch.runTimezoneUpdate,
    runEmailDomainUpdate: batch.runEmailDomainUpdate,
    runEmailClear: batch.runEmailClear,
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
