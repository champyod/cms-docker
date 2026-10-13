'use client';

import { useMemo, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';

import { Button } from '@/components/core/Button';
import { Dialog } from '@/components/core/Dialog';
import { ModalFooter } from '@/components/core/ModalFooter';
import { PasswordKindSelector } from '@/components/core/PasswordFieldWithKind';
import { apiClient } from '@/lib/apiClient';
import { downloadCsvFile, openServerDownload } from '@/lib/csv-download';
import type { Dictionary } from '@/lib/dictionary';
import type { PasswordKind } from '@/lib/password-format';
import {
  BulkCreateInputSection,
  HeaderWarnings,
  PreviewStateAlerts,
  PreviewTable,
  SubmitResultBanner,
  type BulkSubmitResult,
} from './bulkCreateSections';
import { buildSelectedCsv, TEMPLATE_CSV } from './csvTemplate';
import { useBulkCreatePreview } from './useBulkCreatePreview';

interface UserBulkCreateCsvProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  contests: Array<{ id: number; name: string }>;
  canReadContests: boolean;
  navigation: Dictionary['navigation'];
}

export function UserBulkCreateCsv({ isOpen, onClose, onSuccess, contests, canReadContests, navigation }: UserBulkCreateCsvProps) {
  const preview = useBulkCreatePreview();
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<BulkSubmitResult | null>(null);
  const [contestId, setContestId] = useState<number>(0);
  const [ip, setIp] = useState('');
  const [passwordKind, setPasswordKind] = useState<PasswordKind>('bcrypt');

  const placeholder = useMemo(() => TEMPLATE_CSV, []);

  const handleDownloadTemplate = (): void => {
    downloadCsvFile('users-bulk-template.csv', `${TEMPLATE_CSV}\n`);
  };

  const handleExportCreatedCredentials = (): void => {
    if (!submitResult?.success || !submitResult.downloadUrl) return;
    openServerDownload(submitResult.downloadUrl, `users-created-credentials-${Date.now()}.csv`);
  };

  const handleExportSelectedPreview = (): void => {
    if (preview.selectedRowIndices.size === 0) return;
    const selectedRows = preview.previewRows.filter((row) => preview.selectedRowIndices.has(row.rowIndex));
    downloadCsvFile('users-selected.csv', buildSelectedCsv(selectedRows));
  };

  const handleSubmitBulk = async (): Promise<void> => {
    setSubmitResult(null);
    if (preview.stalePreview) {
      setSubmitResult({ error: 'Re-parse the CSV before creating' });
      return;
    }
    if (preview.submittableRows.length === 0) {
      setSubmitResult({ error: 'Select at least one row to create' });
      return;
    }

    setSubmitting(true);
    try {
      const result = await apiClient.post('/api/users/bulk', {
        rows: preview.submittableRows.map((row) => ({
          rowIndex: row.rowIndex,
          first_name: row.first_name,
          last_name: row.last_name,
          username: row.username,
          password: row.password,
          email: row.email,
          timezone: row.timezone,
          team: row.team,
        })),
        generationMode: preview.generationMode,
        contestId: contestId || undefined,
        ip: ip.trim() || undefined,
        passwordKind,
      });

      setSubmitResult(result);
      if (result.success) onSuccess();
    } finally {
      setSubmitting(false);
    }
  };

  // A submit already in flight cannot be recalled, so cancelling through it would
  // close the dialog over an unresolved create.
  const cancel = (): void => {
    if (!submitting) onClose();
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Bulk Add Users (CSV)"
      description={navigation.people.users.label}
      className="sm:max-w-6xl"
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">New password storage</span>
          <PasswordKindSelector kind={passwordKind} onKind={setPasswordKind} />
        </div>

        <BulkCreateInputSection
          contests={canReadContests ? contests : []}
          contestId={contestId}
          canReadContests={canReadContests}
          csvText={preview.csvText}
          placeholder={placeholder}
          ip={ip}
          onContestIdChange={setContestId}
          onCsvTextChange={preview.setCsvText}
          onIpChange={setIp}
          onDownloadTemplate={handleDownloadTemplate}
          onUploadFile={preview.uploadFile}
          onRebuildPreview={() => preview.buildPreview(preview.csvText, preview.generationMode)}
          onFillEmpty={preview.fillEmptyInPreview}
        />

        <HeaderWarnings warnings={preview.headerWarnings} />

        <PreviewStateAlerts
          stalePreview={preview.stalePreview}
          blockingSelectedCount={preview.blockingSelectedCount}
          skipInvalid={preview.skipInvalid}
          onReparse={() => preview.buildPreview(preview.csvText, preview.generationMode)}
          onToggleSkipInvalid={preview.toggleSkipInvalid}
        />

        <PreviewTable
          rows={preview.previewRows.slice(0, 100)}
          totalRowCount={preview.previewRows.length}
          selectedRowIndices={preview.selectedRowIndices}
          onSelectAll={preview.selectAll}
          onToggleRow={preview.toggleRow}
        />

        {preview.selectedRowIndices.size > 0 && (
          <div className="rounded-lg border border-primary/30 bg-primary/10 p-3 text-primary text-xs flex items-center justify-between">
            <span>{preview.selectedRowIndices.size} row(s) selected</span>
            <Button variant="secondary" size="sm" icon={FileSpreadsheet} onClick={handleExportSelectedPreview}>
              Export Selected
            </Button>
          </div>
        )}

        {submitResult && (
          <SubmitResultBanner result={submitResult} onDownloadCredentials={handleExportCreatedCredentials} />
        )}
      </div>
      <ModalFooter
        className="mt-4 pt-4 border-t border-border"
        cancelLabel="Cancel"
        cancelVariant="negativeOutline"
        confirmLabel={preview.confirmLabel}
        onCancel={cancel}
        onConfirm={handleSubmitBulk}
        confirmLoading={submitting}
        confirmDisabled={submitting || !preview.canSubmit}
        leadingAction={<span className="text-xs text-muted-foreground">Generation mode: {preview.generationMode}</span>}
      />
    </Dialog>
  );
}
