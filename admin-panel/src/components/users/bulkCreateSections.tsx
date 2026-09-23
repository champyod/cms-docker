'use client';

import { AlertTriangle, FileSpreadsheet, Table2, Upload, Wand2 } from 'lucide-react';
import { Button } from '@/components/core/Button';
import { cn } from '@/lib/utils';
import { EXPECTED_FIELDS } from './csvTemplate';
import type { GenerationMode } from './csvPreview';

export interface BulkSubmitFailure {
  rowIndex: number;
  reason: string;
}

export interface BulkSubmitResult {
  success?: boolean;
  error?: string;
  createdCount?: number;
  failedCount?: number;
  downloadUrl?: string;
  failed?: BulkSubmitFailure[];
}

interface HeaderWarningsProps {
  warnings: string[];
}

export function HeaderWarnings({ warnings }: HeaderWarningsProps) {
  if (warnings.length === 0) return null;

  return (
    <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-warning text-xs space-y-1">
      {warnings.map((warning) => (
        <div key={warning} className="flex items-center gap-2">
          <AlertTriangle className="w-3 h-3" /> {warning}
        </div>
      ))}
    </div>
  );
}

interface SubmitResultBannerProps {
  result: BulkSubmitResult;
  onDownloadCredentials: () => void;
}

export function SubmitResultBanner({ result, onDownloadCredentials }: SubmitResultBannerProps) {
  return (
    <div className={cn(
      'rounded-lg border p-3 text-xs',
      result.success ? 'border-success/30 bg-success/10 text-success' : 'border-destructive/30 bg-destructive/10 text-destructive'
    )}>
      {result.success ? (
        <div className="space-y-1">
          <div>Created: {result.createdCount} | Failed: {result.failedCount}</div>
          {result.downloadUrl && (
            <div className="pt-2">
              <Button variant="secondary" size="sm" icon={FileSpreadsheet} onClick={onDownloadCredentials}>
                Download Credentials CSV
              </Button>
            </div>
          )}
          {Array.isArray(result.failed) && result.failed.length > 0 && (
            <div className="max-h-32 overflow-auto">
              {result.failed.map((failure) => (
                <div key={`${failure.rowIndex}-${failure.reason}`}>Row {failure.rowIndex}: {failure.reason}</div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div>{result.error || 'Bulk create failed'}</div>
      )}
    </div>
  );
}

interface BulkCreateInputSectionProps {
  contests: Array<{ id: number; name: string }>;
  contestId: number;
  csvText: string;
  placeholder: string;
  onContestIdChange: (contestId: number) => void;
  onCsvTextChange: (text: string) => void;
  onDownloadTemplate: () => void;
  onUploadFile: (file: File | undefined) => void;
  onRebuildPreview: () => void;
  onFillEmpty: (mode: GenerationMode) => void;
}

const SELECT_CLASS = 'bg-background/60 border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/30 transition-colors';

const LABEL_BUTTON_CLASS = 'inline-flex items-center gap-2 h-8 px-3 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 cursor-pointer text-sm transition-colors';

export function BulkCreateInputSection({
  contests,
  contestId,
  csvText,
  placeholder,
  onContestIdChange,
  onCsvTextChange,
  onDownloadTemplate,
  onUploadFile,
  onRebuildPreview,
  onFillEmpty,
}: BulkCreateInputSectionProps) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          First row must be header. Supported columns: {EXPECTED_FIELDS.join(', ')}. Team column is applied when a contest is selected.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" icon={Table2} onClick={onDownloadTemplate}>
            Download CSV Template
          </Button>
          <label className={LABEL_BUTTON_CLASS}>
            <Upload className="w-4 h-4" />
            Upload CSV
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(event) => onUploadFile(event.target.files?.[0])}
            />
          </label>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-xs text-muted-foreground">Contest for team mapping:</label>
        <select
          value={contestId}
          onChange={(event) => onContestIdChange(Number(event.target.value) || 0)}
          className={SELECT_CLASS}
          title="Contest for team mapping"
        >
          <option value={0}>No contest</option>
          {contests.map((contest) => (
            <option key={contest.id} value={contest.id}>#{contest.id} - {contest.name}</option>
          ))}
        </select>
      </div>

      <textarea
        value={csvText}
        onChange={(event) => onCsvTextChange(event.target.value)}
        placeholder={placeholder}
        className="w-full h-44 overflow-auto bg-background/60 border border-border rounded-lg p-3 text-sm text-foreground font-mono resize-none placeholder:text-muted-foreground focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/30 transition-colors"
      />

      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" icon={FileSpreadsheet} onClick={onRebuildPreview}>
          Parse &amp; Preview
        </Button>
        <Button variant="ghost" icon={Wand2} onClick={() => onFillEmpty('both')}>
          Random Username + Password
        </Button>
        <Button variant="ghost" icon={Wand2} onClick={() => onFillEmpty('username')}>
          Random Username
        </Button>
        <Button variant="ghost" icon={Wand2} onClick={() => onFillEmpty('password')}>
          Random Password
        </Button>
      </div>
    </>
  );
}

export { PreviewTable } from './bulkCreatePreviewTable';
