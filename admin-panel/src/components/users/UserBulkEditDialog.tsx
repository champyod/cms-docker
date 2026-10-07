'use client';

import { Download, Wand2 } from 'lucide-react';
import { Button } from '@/components/core/Button';
import { Dialog } from '@/components/core/Dialog';
import { ModalFooter } from '@/components/core/ModalFooter';
import { InlineAlert } from '@/components/core/InlineAlert';
import { PasswordKindSelector } from '@/components/core/PasswordFieldWithKind';
import type { Dictionary } from '@/lib/dictionary';
import { BulkEditPreviewTable, ContestSection, ProfileSection, TeamSection } from './bulkEditSections';
import { buildEditExportCsv, type ContestOption, type SelectedUser } from './bulkEditActions';
import { useBulkEditActions } from './useBulkEditActions';

interface UserBulkEditDialogProps {
  isOpen: boolean;
  onClose: () => void;
  selectedUsers: SelectedUser[];
  contests: ContestOption[];
  canReadContests: boolean;
  navigation: Dictionary['navigation'];
  onSuccess: () => void;
}

export function UserBulkEditDialog({ isOpen, onClose, selectedUsers, contests, canReadContests, navigation, onSuccess }: UserBulkEditDialogProps) {
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

  // Why the guard: an apply already in flight cannot be recalled, so cancelling
  // through it would close the dialog over an unresolved write.
  const cancel = (): void => {
    if (!loading) onClose();
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Edit Selected Users"
      description={navigation.people.users.label}
      className="sm:max-w-6xl"
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs">
          Selected: {rows.length} user(s)
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">New password storage</span>
          <PasswordKindSelector kind={passwordKind} onKind={setPasswordKind} />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" icon={Wand2} iconOnly tooltip="Regenerate Username" onClick={() => runRegenerate('username')} disabled={loading || rows.length === 0} />
          <Button variant="ghost" icon={Wand2} iconOnly tooltip="Regenerate Password" onClick={() => runRegenerate('password')} disabled={loading || rows.length === 0} />
          <Button variant="secondary" icon={Download} iconOnly tooltip="Export CSV" onClick={handleExportSelectedRows} disabled={rows.length === 0} />
        </div>

        {canReadContests && (
          <ContestSection
            contests={contests}
            selectedContestId={selectedContestId}
            loading={loading}
            hasRows={rows.length > 0}
            onContestIdChange={setSelectedContestId}
            onRunContestMutation={runContestMutation}
          />
        )}

        {canReadContests && (
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
        )}

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

        {statusMessage && <InlineAlert tone="success" density="compact" className="border-success/30">{statusMessage}</InlineAlert>}
        {errorMessage && <InlineAlert tone="destructive" density="compact" className="border-destructive/30">{errorMessage}</InlineAlert>}

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
      <ModalFooter
        className="mt-4 pt-4 border-t border-border"
        cancelLabel="Cancel"
        cancelVariant="negativeOutline"
        confirmLabel="Done"
        confirmVariant="positiveOutline"
        onCancel={cancel}
        onConfirm={(): void => void applyCredentials(true)}
        confirmLoading={loading}
        confirmDisabled={loading}
      />
    </Dialog>
  );
}
