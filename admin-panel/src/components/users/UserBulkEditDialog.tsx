'use client';

import { Download, Loader2, Wand2, X } from 'lucide-react';
import { Button } from '@/components/core/Button';
import { Portal } from '@/components/core/Portal';
import { PasswordKindSelector } from '@/components/core/PasswordFieldWithKind';
import { BulkEditPreviewTable, ContestSection, ProfileSection, TeamSection } from './bulkEditSections';
import { buildEditExportCsv, type ContestOption, type SelectedUser } from './bulkEditActions';
import { useBulkEditActions } from './useBulkEditActions';

interface UserBulkEditDialogProps {
  isOpen: boolean;
  onClose: () => void;
  selectedUsers: SelectedUser[];
  contests: ContestOption[];
  onSuccess: () => void;
}

export function UserBulkEditDialog({ isOpen, onClose, selectedUsers, contests, onSuccess }: UserBulkEditDialogProps) {
  const {
    loading, statusMessage, errorMessage,
    selectedContestId, setSelectedContestId,
    teamContestId, setTeamContestId,
    teamCode, setTeamCode,
    timezone, setTimezone,
    emailDomain, setEmailDomain,
    passwordKind, setPasswordKind,
    rows, teamsOptions,
    revealedIds, revealingIds, allRevealed,
    revealRowPassword, toggleAllRevealed,
    runRegenerate, exportSelectedRows,
    runContestMutation, runTeamSet, runTeamRemoveAny,
    runTimezoneUpdate, runEmailDomainUpdate, runEmailClear,
    applyCredentials,
  } = useBulkEditActions({ selectedUsers, contests, onSuccess, onClose });

  if (!isOpen) return null;

  const handleExportSelectedRows = (): void => {
    exportSelectedRows(`users-selected-${Date.now()}.csv`, buildEditExportCsv);
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

            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider text-neutral-500">New password storage</span>
              <PasswordKindSelector kind={passwordKind} onKind={setPasswordKind} />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => runRegenerate('username')} disabled={loading || rows.length === 0}>
                <Wand2 className="w-4 h-4 mr-2" /> Regenerate Username
              </Button>
              <Button variant="ghost" onClick={() => runRegenerate('password')} disabled={loading || rows.length === 0}>
                <Wand2 className="w-4 h-4 mr-2" /> Regenerate Password
              </Button>
              <Button variant="secondary" onClick={handleExportSelectedRows} disabled={rows.length === 0}>
                <Download className="w-4 h-4 mr-2" /> Export CSV
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

            <BulkEditPreviewTable
              rows={rows}
              revealedIds={revealedIds}
              revealingIds={revealingIds}
              allRevealed={allRevealed}
              onToggleRevealRow={revealRowPassword}
              onToggleAllRevealed={toggleAllRevealed}
            />

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
            <Button variant="primary" onClick={() => applyCredentials(true)} disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Done'}
            </Button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
