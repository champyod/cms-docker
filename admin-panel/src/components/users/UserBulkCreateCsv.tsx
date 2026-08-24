'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/core/Button';
import { X, Loader2, FileSpreadsheet } from 'lucide-react';
import { apiClient } from '@/lib/apiClient';
import { Portal } from '@/components/core/Portal';
import { PasswordKindSelector } from '@/components/core/PasswordFieldWithKind';
import type { PasswordKind } from '@/lib/password-format';
import {
  buildPreviewRows,
  fillRowCredentials,
  type GenerationMode,
  type PreviewRow,
} from './csvPreview';
import { buildSelectedCsv, TEMPLATE_CSV } from './csvTemplate';
import {
  BulkCreateInputSection,
  HeaderWarnings,
  PreviewTable,
  SubmitResultBanner,
  type BulkSubmitResult,
} from './bulkCreateSections';

interface UserBulkCreateCsvProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  contests: Array<{ id: number; name: string }>;
}

function downloadCsv(filename: string, content: string): void {
  // UTF-8 BOM keeps Thai characters readable in Excel/LibreOffice
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

export function UserBulkCreateCsv({ isOpen, onClose, onSuccess, contests }: UserBulkCreateCsvProps) {
  const [csvText, setCsvText] = useState('');
  const [headerWarnings, setHeaderWarnings] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [generationMode, setGenerationMode] = useState<GenerationMode>('none');
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<BulkSubmitResult | null>(null);
  const [selectedRowIndices, setSelectedRowIndices] = useState<Set<number>>(new Set());
  const [contestId, setContestId] = useState<number>(0);
  const [passwordKind, setPasswordKind] = useState<PasswordKind>('bcrypt');

  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  const placeholder = useMemo(() => TEMPLATE_CSV, []);

  const handleDownloadTemplate = (): void => {
    downloadCsv('users-bulk-template.csv', `${TEMPLATE_CSV}\n`);
  };

  const handleExportCreatedCredentials = (): void => {
    if (!submitResult?.success || !submitResult.downloadUrl) {
      return;
    }
    const anchor = document.createElement('a');
    anchor.href = submitResult.downloadUrl;
    anchor.setAttribute('download', `users-created-credentials-${Date.now()}.csv`);
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  };

  const handleExportSelectedPreview = (): void => {
    if (selectedRowIndices.size === 0) return;

    const selectedRows = previewRows.filter((row) => selectedRowIndices.has(row.rowIndex));
    downloadCsv('users-selected.csv', buildSelectedCsv(selectedRows));
  };

  const buildPreview = (text: string, mode: GenerationMode): void => {
    const { warnings, rows } = buildPreviewRows(text, mode);
    setHeaderWarnings(warnings);
    setPreviewRows(rows);
    setSelectedRowIndices(new Set());
  };

  const handleUploadFile = (file: File | undefined): void => {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = String(event.target?.result ?? '');
      setCsvText(text);
      buildPreview(text, generationMode);
    };
    reader.readAsText(file);
  };

  const regeneratePreview = (mode: GenerationMode): void => {
    setGenerationMode(mode);
    buildPreview(csvText, mode);
  };

  const fillEmptyInPreview = (mode: GenerationMode): void => {
    setGenerationMode(mode);
    const usedUsernames = new Set<string>();
    setPreviewRows((previousRows) =>
      previousRows.map((row) => fillRowCredentials(row, mode, usedUsernames))
    );
  };

  const handleSubmitBulk = async (): Promise<void> => {
    setSubmitResult(null);
    if (previewRows.length === 0) {
      setSubmitResult({ error: 'No parsed rows to submit' });
      return;
    }

    setSubmitting(true);
    try {
      const result = await apiClient.post('/api/users/bulk', {
        rows: previewRows.map((row) => ({
          rowIndex: row.rowIndex,
          first_name: row.first_name,
          last_name: row.last_name,
          username: row.username,
          password: row.password,
          email: row.email,
          timezone: row.timezone,
          team: row.team,
        })),
        generationMode,
        contestId: contestId || undefined,
        passwordKind,
      });

      setSubmitResult(result);
      if (result.success) onSuccess();
    } finally {
      setSubmitting(false);
    }
  };

  const toggleRow = (rowIndex: number, checked: boolean): void => {
    setSelectedRowIndices((previous) => {
      const next = new Set(previous);
      if (checked) next.add(rowIndex);
      else next.delete(rowIndex);
      return next;
    });
  };

  if (!isOpen) return null;

  return (
    <Portal>
      <div className="fixed inset-0 z-100 flex items-center justify-center overflow-hidden bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
        <div className="relative z-10 w-full max-w-6xl max-h-[90vh] bg-neutral-900 border border-white/10 rounded-xl shadow-2xl flex flex-col" onClick={(event) => event.stopPropagation()}>
          <div className="flex items-center justify-between p-4 border-b border-white/10">
            <h2 className="text-xl font-bold text-white">Bulk Add Users (CSV)</h2>
            <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg transition-colors" title="Close" aria-label="Close">
              <X className="w-5 h-5 text-neutral-400" />
            </button>
          </div>

          {/* INPUT */}
          <div className="p-4 space-y-4 overflow-auto">
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider text-neutral-500">New password storage</span>
              <PasswordKindSelector kind={passwordKind} onKind={setPasswordKind} />
            </div>

            <BulkCreateInputSection
              contests={contests}
              contestId={contestId}
              csvText={csvText}
              placeholder={placeholder}
              onContestIdChange={setContestId}
              onCsvTextChange={setCsvText}
              onDownloadTemplate={handleDownloadTemplate}
              onUploadFile={handleUploadFile}
              onRebuildPreview={() => buildPreview(csvText, generationMode)}
              onFillEmpty={fillEmptyInPreview}
            />

            <HeaderWarnings warnings={headerWarnings} />

            <PreviewTable
              rows={previewRows.slice(0, 100)}
              totalRowCount={previewRows.length}
              selectedRowIndices={selectedRowIndices}
              onSelectAll={(checked) => {
                setSelectedRowIndices(checked ? new Set(previewRows.map((r) => r.rowIndex)) : new Set());
              }}
              onToggleRow={toggleRow}
            />

            {selectedRowIndices.size > 0 && (
              <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-3 text-indigo-300 text-xs flex items-center justify-between">
                <span>{selectedRowIndices.size} row(s) selected</span>
                <button
                  onClick={handleExportSelectedPreview}
                  className="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 transition-colors"
                >
                  <FileSpreadsheet className="w-3 h-3" />
                  Export Selected
                </button>
              </div>
            )}

            {submitResult && (
              <SubmitResultBanner result={submitResult} onDownloadCredentials={handleExportCreatedCredentials} />
            )}
          </div>

          {/* FOOTER */}
          <div className="p-4 border-t border-white/10 flex items-center justify-between gap-3">
            <span className="text-xs text-neutral-400">Generation mode: {generationMode}</span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={onClose} disabled={submitting}>Cancel</Button>
              <Button variant="primary" onClick={handleSubmitBulk} disabled={submitting || previewRows.length === 0}>
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create Users from Preview'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
}
