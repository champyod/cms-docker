'use client';

import { AlertTriangle, FileSpreadsheet, Table2, Upload, Wand2 } from 'lucide-react';
import { Button } from '@/components/core/Button';
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
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-300 text-xs space-y-1">
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
    <div className="border border-white/10 rounded-lg overflow-hidden">
      <div className="max-h-80 overflow-auto">
        <table className="w-full text-xs">
          <thead className="bg-white/5 text-neutral-300 sticky top-0 z-10">
            <tr>
              <th className="text-left px-2 py-2 w-8">
                <input
                  type="checkbox"
                  title="Select all rows"
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
                <td colSpan={9} className="px-3 py-6 text-center text-neutral-500">
                  No preview rows yet
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.rowIndex} className={`border-t border-white/5 ${selectedRowIndices.has(row.rowIndex) ? 'bg-indigo-500/10' : ''}`}>
                  <td className="px-2 py-2 text-center">
                    <input
                      type="checkbox"
                      title={`Select row ${row.rowIndex}`}
                      checked={selectedRowIndices.has(row.rowIndex)}
                      onChange={(e) => onToggleRow(row.rowIndex, e.target.checked)}
                    />
                  </td>
                  <td className="px-2 py-2 text-white">{row.first_name}</td>
                  <td className="px-2 py-2 text-white">{row.last_name}</td>
                  <td className="px-2 py-2 text-white">{row.username}</td>
                  <td className="px-2 py-2 text-white">{row.password}</td>
                  <td className="px-2 py-2 text-white">{row.email}</td>
                  <td className="px-2 py-2 text-white">{row.timezone}</td>
                  <td className="px-2 py-2 text-white">{row.team}</td>
                  <td className="px-2 py-2 text-amber-300">{row.issues.join(', ') || '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {rowsLeft > 0 && (
        <div className="px-3 py-2 text-xs text-neutral-400 border-t border-white/10 bg-black/20">
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
    <div className={`rounded-lg border p-3 text-xs ${result.success ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-red-500/30 bg-red-500/10 text-red-300'}`}>
      {result.success ? (
        <div className="space-y-1">
          <div>Created: {result.createdCount} | Failed: {result.failedCount}</div>
          {result.downloadUrl && (
            <div className="pt-2">
              <Button variant="ghost" onClick={onDownloadCredentials}>
                <FileSpreadsheet className="w-4 h-4 mr-2" /> Download Credentials CSV
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
        <p className="text-xs text-neutral-400">
          First row must be header. Supported columns: {EXPECTED_FIELDS.join(', ')}. Team column is applied when a contest is selected.
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={onDownloadTemplate}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-200 cursor-pointer text-sm transition-colors"
          >
            <Table2 className="w-4 h-4" />
            Download CSV Template
          </button>
          <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-200 cursor-pointer text-sm transition-colors">
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
        <label className="text-xs text-neutral-400">Contest for team mapping:</label>
        <select
          value={contestId}
          onChange={(event) => onContestIdChange(Number(event.target.value) || 0)}
          className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
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
        className="w-full h-44 overflow-auto bg-black/40 border border-white/10 rounded-lg p-3 text-sm text-white font-mono resize-none"
      />

      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" onClick={onRebuildPreview}>
          <FileSpreadsheet className="w-4 h-4 mr-2" /> Parse & Preview
        </Button>
        <Button variant="ghost" onClick={() => onFillEmpty('both')}>
          <Wand2 className="w-4 h-4 mr-2" /> Random Username + Password
        </Button>
        <Button variant="ghost" onClick={() => onFillEmpty('username')}>
          <Wand2 className="w-4 h-4 mr-2" /> Random Username
        </Button>
        <Button variant="ghost" onClick={() => onFillEmpty('password')}>
          <Wand2 className="w-4 h-4 mr-2" /> Random Password
        </Button>
      </div>
    </>
  );
}
