'use client';

import { AlertTriangle, FileSpreadsheet, Table2, Upload, Wand2 } from 'lucide-react';
import { Button } from '@/components/core/Button';
import { cn } from '@/lib/utils';
import { EXPECTED_FIELDS } from './csvTemplate';
import type { GenerationMode, PreviewRow } from './csvPreview';

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

const PREVIEW_COLUMNS = ['first_name', 'last_name', 'username', 'password', 'email', 'timezone', 'team'];
const MAX_VISIBLE_PREVIEW_ROWS = 100;

const CHECKBOX_CLASS = 'size-4 accent-primary cursor-pointer';

interface PreviewTableProps {
  rows: PreviewRow[];
  totalRowCount: number;
  selectedRowIndices: Set<number>;
  onSelectAll: (checked: boolean) => void;
  onToggleRow: (rowIndex: number, checked: boolean) => void;
}

export function PreviewTable({ rows, totalRowCount, selectedRowIndices, onSelectAll, onToggleRow }: PreviewTableProps) {
  const rowsLeft = Math.max(totalRowCount - MAX_VISIBLE_PREVIEW_ROWS, 0);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="max-h-80 overflow-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/50 text-muted-foreground sticky top-0 z-10">
            <tr>
              <th className="text-left px-2 py-2 w-8">
                <input
                  type="checkbox"
                  title="Select all rows"
                  className={CHECKBOX_CLASS}
                  checked={selectedRowIndices.size > 0 && selectedRowIndices.size === totalRowCount}
                  onChange={(e) => onSelectAll(e.target.checked)}
                />
              </th>
              {PREVIEW_COLUMNS.map((column) => (
                <th key={column} className="text-left px-2 py-2">{column}</th>
              ))}
              <th className="text-left px-2 py-2">Issues</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                  No preview rows yet
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.rowIndex} className={cn('border-t border-border', selectedRowIndices.has(row.rowIndex) && 'bg-primary/10')}>
                  <td className="px-2 py-2 text-center">
                    <input
                      type="checkbox"
                      title={`Select row ${row.rowIndex}`}
                      className={CHECKBOX_CLASS}
                      checked={selectedRowIndices.has(row.rowIndex)}
                      onChange={(e) => onToggleRow(row.rowIndex, e.target.checked)}
                    />
                  </td>
                  <td className="px-2 py-2">{row.first_name}</td>
                  <td className="px-2 py-2">{row.last_name}</td>
                  <td className="px-2 py-2">{row.username}</td>
                  <td className="px-2 py-2">{row.password}</td>
                  <td className="px-2 py-2">{row.email}</td>
                  <td className="px-2 py-2">{row.timezone}</td>
                  <td className="px-2 py-2">{row.team}</td>
                  <td className="px-2 py-2 text-warning">{row.issues.join(', ') || '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {rowsLeft > 0 && (
        <div className="px-3 py-2 text-xs text-muted-foreground border-t border-border bg-muted/30">
          ... {rowsLeft} rows left (showing first {MAX_VISIBLE_PREVIEW_ROWS})
        </div>
      )}
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
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          First row must be header. Supported columns: {EXPECTED_FIELDS.join(', ')}. Team column is applied when a contest is selected.
        </p>
        <div className="flex items-center gap-2">
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
