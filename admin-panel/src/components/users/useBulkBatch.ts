'use client';

import { apiClient } from '@/lib/apiClient';
import { openServerDownload } from './bulkEditActions';
import type { BatchActionResult, ContestOption, SelectedUser } from './bulkEditActions';

interface BatchDeps {
  rows: SelectedUser[];
  setRows: (updater: (previous: SelectedUser[]) => SelectedUser[]) => void;
  selectedUserIds: number[];
  contests: ContestOption[];
  selectedContestId: number;
  teamContestId: number;
  teamCode: string;
  timezone: string;
  emailDomain: string;
  setLoading: (value: boolean) => void;
  setStatusMessage: (value: string) => void;
  setErrorMessage: (value: string) => void;
  onSuccess: () => void;
}

function requireValue(value: string, label: string, setError: (message: string) => void): boolean {
  if (!value.trim()) {
    setError(`${label} is required`);
    return false;
  }
  return true;
}

export function useBulkBatch(deps: BatchDeps) {
  const runBatchAction = async (
    payload: Record<string, unknown>,
    buildStatus: (result: BatchActionResult) => string,
    options: { applyLocal?: (rows: SelectedUser[]) => SelectedUser[]; fallbackError?: string } = {}
  ): Promise<void> => {
    deps.setLoading(true);
    deps.setErrorMessage('');
    deps.setStatusMessage('');
    const result = (await apiClient.post('/api/users/batch', payload)) as BatchActionResult;
    if (!result.success) {
      deps.setErrorMessage(result.error || options.fallbackError || 'Failed to update users');
      deps.setLoading(false);
      return;
    }
    if (options.applyLocal) deps.setRows(options.applyLocal);
    deps.setStatusMessage(buildStatus(result));
    deps.setLoading(false);
    deps.onSuccess();
  };

  const exportCurrentPasswords = async (): Promise<void> => {
    if (deps.selectedUserIds.length === 0) return;
    deps.setLoading(true);
    deps.setErrorMessage('');
    deps.setStatusMessage('');
    try {
      const result = (await apiClient.post('/api/users/batch', {
        action: 'export-current',
        userIds: deps.selectedUserIds,
      })) as BatchActionResult;
      if (!result.success) {
        deps.setErrorMessage(result.error || 'Export failed');
        deps.setLoading(false);
        return;
      }
      if (result.downloadUrl) openServerDownload(result.downloadUrl);
      deps.setStatusMessage(
        typeof result.count === 'number' && result.count > 0
          ? `Exported ${result.count} plain-text password(s)`
          : 'No plain-text stored passwords in selection'
      );
    } catch (error) {
      deps.setErrorMessage((error as Error)?.message || 'Network error');
    }
    deps.setLoading(false);
  };

  const runContestMutation = (mode: 'add' | 'remove'): void => {
    if (deps.selectedUserIds.length === 0 || !deps.selectedContestId) return;
    void runBatchAction(
      { action: 'contest', mode, contestId: deps.selectedContestId, userIds: deps.selectedUserIds },
      (result) => {
        const name = deps.contests.find((contest) => contest.id === deps.selectedContestId)?.name || `#${deps.selectedContestId}`;
        return mode === 'add'
          ? `Added ${result.addedCount ?? 0} user(s) to contest ${name}`
          : `Removed ${result.removedCount ?? 0} user(s) from contest ${name}`;
      },
      { fallbackError: 'Failed to update contest participation' }
    );
  };

  const runTeamSet = (): void => {
    if (deps.selectedUserIds.length === 0 || !deps.teamContestId) return;
    if (!requireValue(deps.teamCode, 'Team code', deps.setErrorMessage)) return;
    void runBatchAction(
      { action: 'team', mode: 'set', contestId: deps.teamContestId, teamCode: deps.teamCode.trim(), userIds: deps.selectedUserIds },
      (result) => {
        const name = deps.contests.find((contest) => contest.id === deps.teamContestId)?.name || `#${deps.teamContestId}`;
        return `Assigned team ${deps.teamCode.trim()} for ${result.updatedCount ?? 0} user(s) in contest ${name}`;
      },
      { fallbackError: 'Failed to set team' }
    );
  };

  const runTeamRemoveAny = (): void => {
    if (deps.selectedUserIds.length === 0) return;
    void runBatchAction(
      { action: 'team', mode: 'remove-any', userIds: deps.selectedUserIds },
      (result) => `Removed team from ${result.updatedCount ?? 0} participation(s)`,
      { fallbackError: 'Failed to remove teams' }
    );
  };

  const runTimezoneUpdate = (): void => {
    if (deps.selectedUserIds.length === 0) return;
    if (!requireValue(deps.timezone, 'Timezone', deps.setErrorMessage)) return;
    void runBatchAction(
      { action: 'profile', mode: 'timezone', timezone: deps.timezone.trim(), userIds: deps.selectedUserIds },
      (result) => `Updated timezone for ${result.updatedCount ?? 0} user(s)`,
      { fallbackError: 'Failed to update timezone' }
    );
  };

  const runEmailDomainUpdate = (): void => {
    if (deps.selectedUserIds.length === 0) return;
    if (!requireValue(deps.emailDomain, 'Email domain', deps.setErrorMessage)) return;
    void runBatchAction(
      { action: 'profile', mode: 'email-domain', emailDomain: deps.emailDomain.trim(), userIds: deps.selectedUserIds },
      (result) => `Updated email domain for ${result.updatedCount ?? 0} user(s)`,
      {
        fallbackError: 'Failed to update email domain',
        applyLocal: (previous) =>
          previous.map((user) => {
            const localPart = (user.email?.split('@')[0] || user.username).trim();
            return { ...user, email: `${localPart}@${deps.emailDomain.trim().toLowerCase()}` };
          }),
      }
    );
  };

  const runEmailClear = (): void => {
    if (deps.selectedUserIds.length === 0) return;
    void runBatchAction(
      { action: 'profile', mode: 'clear-email', userIds: deps.selectedUserIds },
      (result) => `Cleared email for ${result.updatedCount ?? 0} user(s)`,
      { fallbackError: 'Failed to clear emails', applyLocal: (previous) => previous.map((user) => ({ ...user, email: null })) }
    );
  };

  return {
    runBatchAction,
    exportCurrentPasswords,
    runContestMutation,
    runTeamSet,
    runTeamRemoveAny,
    runTimezoneUpdate,
    runEmailDomainUpdate,
    runEmailClear,
  };
}
