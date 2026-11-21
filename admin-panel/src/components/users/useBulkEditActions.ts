'use client';

import { useEffect, useMemo, useState } from 'react';

import { getTeams } from '@/app/actions/teams';
import { PASSWORD_CONFIG, USERNAME_CONFIG, type GeneratorConfig } from '@/lib/credential-template';
import { downloadCsvFile } from '@/lib/csv-download';
import type { PasswordKind } from '@/lib/password-format';
import { collectCredentialUpdates, regenerateCredentials, submitCredentialUpdates } from './bulkEditActions';
import type { BatchFailure, ContestOption, RegenerateMode, SelectedUser } from './bulkEditActions';
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
  const [ipContestId, setIpContestId] = useState<number>(contests[0]?.id ?? 0);
  const [ip, setIp] = useState('');
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [emailDomain, setEmailDomain] = useState('');
  const [passwordKind, setPasswordKind] = useState<PasswordKind>('bcrypt');
  const [usernameTemplate, setUsernameTemplate] = useState('');
  const [passwordTemplate, setPasswordTemplate] = useState('');
  const [usernameConfig, setUsernameConfig] = useState<GeneratorConfig>(USERNAME_CONFIG);
  const [passwordConfig, setPasswordConfig] = useState<GeneratorConfig>(PASSWORD_CONFIG);
  const [rows, setRows] = useState(selectedUsers);
  const [teamsOptions, setTeamsOptions] = useState<string[]>([]);
  const [renderedUsers, setRenderedUsers] = useState<SelectedUser[] | null>(null);
  const [failures, setFailures] = useState<BatchFailure[]>([]);
  if (renderedUsers !== selectedUsers) {
    setRenderedUsers(selectedUsers);
    setRows(selectedUsers.map((user) => ({ ...user, password: null })));
  }

  const { revealedIds, revealingIds, allRevealed, revealRowPassword, toggleAllRevealed } = useBulkReveal(rows, setRows);

  useEffect(() => {
    if (contests.length === 0 || contests.some((contest) => contest.id === selectedContestId)) return;
    queueMicrotask(() => {
      setSelectedContestId(contests[0].id);
    });
  }, [contests, selectedContestId]);

  useEffect(() => {
    if (contests.length === 0 || contests.some((contest) => contest.id === teamContestId)) return;
    queueMicrotask(() => {
      setTeamContestId(contests[0].id);
    });
  }, [contests, teamContestId]);

  useEffect(() => {
    if (contests.length === 0 || contests.some((contest) => contest.id === ipContestId)) return;
    queueMicrotask(() => {
      setIpContestId(contests[0].id);
    });
  }, [contests, ipContestId]);

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
  const credentialChangeCount = useMemo(
    () => collectCredentialUpdates(rows, selectedUsers).length,
    [rows, selectedUsers],
  );

  const batch = useBulkBatch({
    rows,
    setRows,
    selectedUserIds,
    contests,
    selectedContestId,
    teamContestId,
    teamCode,
    ipContestId,
    ip,
    timezone,
    emailDomain,
    setLoading,
    setStatusMessage,
    setErrorMessage,
    onSuccess,
  });

  // Why the templates are read on the call: regeneration is the operator's action, so the
  // fields must render as they stand now, after any later edit to them.
  const runRegenerate = (mode: RegenerateMode): void => {
    if (selectedUserIds.length === 0) return;
    setLoading(true);
    setErrorMessage('');
    setStatusMessage('');
    const templates = { username: usernameTemplate, password: passwordTemplate, usernameConfig, passwordConfig };
    setRows((previous) => regenerateCredentials(previous, mode, templates));
    setStatusMessage(`Locally regenerated ${mode} for ${selectedUserIds.length} user(s)`);
    setLoading(false);
  };

  const exportSelectedRows = (filename: string, buildCsv: (rows: SelectedUser[]) => string): void => {
    if (rows.length === 0) return;
    downloadCsvFile(filename, buildCsv(rows));
  };

  const applyCredentials = (closeAfter: boolean): Promise<void> =>
    submitCredentialUpdates(
      rows,
      selectedUsers,
      closeAfter,
      onClose,
      onSuccess,
      { setLoading, setErrorMessage, setStatusMessage, setFailures },
      passwordKind,
    );

  return {
    loading,
    statusMessage,
    errorMessage,
    failures,
    credentialChangeCount,
    selectedContestId,
    setSelectedContestId,
    teamContestId,
    setTeamContestId,
    teamCode,
    setTeamCode,
    ipContestId,
    setIpContestId,
    ip,
    setIp,
    timezone,
    setTimezone,
    emailDomain,
    setEmailDomain,
    passwordKind,
    setPasswordKind,
    usernameTemplate,
    setUsernameTemplate,
    passwordTemplate,
    setPasswordTemplate,
    usernameConfig,
    setUsernameConfig,
    passwordConfig,
    setPasswordConfig,
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
    runIpAllowlist: batch.runIpAllowlist,
    runTimezoneUpdate: batch.runTimezoneUpdate,
    runEmailDomainUpdate: batch.runEmailDomainUpdate,
    runEmailClear: batch.runEmailClear,
  };
}
