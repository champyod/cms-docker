'use client';

import { Download, Wand2 } from 'lucide-react';
import { Button } from '@/components/core/Button';
import { Dialog, DialogFooter } from '@/components/core/Dialog';
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

  const handleExportSelectedRows = (): void => {
    exportSelectedRows(`users-selected-${Date.now()}.csv`, buildEditExportCsv);
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Edit Selected Users"
      className="sm:max-w-6xl"
    >
      {/* CONTROLS */}
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs">
          Selected: {rows.length} user(s)
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">New password storage</span>
          <PasswordKindSelector kind={passwordKind} onKind={setPasswordKind} />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" icon={Wand2} onClick={() => runRegenerate('username')} disabled={loading || rows.length === 0}>
            Regenerate Username
          </Button>
          <Button variant="ghost" icon={Wand2} onClick={() => runRegenerate('password')} disabled={loading || rows.length === 0}>
            Regenerate Password
          </Button>
          <Button variant="secondary" icon={Download} onClick={handleExportSelectedRows} disabled={rows.length === 0}>
            Export CSV
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

        {statusMessage && <div className="rounded-lg border border-success/30 bg-success/10 p-3 text-xs text-success">{statusMessage}</div>}
        {errorMessage && <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">{errorMessage}</div>}

        <BulkEditPreviewTable
          rows={rows}
          revealedIds={revealedIds}
          revealingIds={revealingIds}
          allRevealed={allRevealed}
          onToggleRevealRow={revealRowPassword}
          onToggleAllRevealed={toggleAllRevealed}
        />

        <div className="flex items-center justify-end gap-2">
          <Button variant="positiveOutline" onClick={() => applyCredentials(false)} disabled={loading || rows.length === 0}>
            Apply Credentials
          </Button>
        </div>
      </div>

      {/* FOOTER */}
      <DialogFooter className="mt-4 pt-4 border-t border-border">
        <Button variant="negativeOutline" onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button variant="positiveOutline" loading={loading} onClick={() => applyCredentials(true)} disabled={loading}>
          Done
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
