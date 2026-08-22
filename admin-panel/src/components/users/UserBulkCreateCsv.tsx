'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/core/Button';
import { Upload, FileSpreadsheet, Wand2, Table2, AlertTriangle, X, Loader2 } from 'lucide-react';
import { apiClient } from '@/lib/apiClient';
import { createPortal } from 'react-dom';

type GenerationMode = 'none' | 'username' | 'password' | 'both';

type PreviewRow = {
  rowIndex: number;
  first_name: string;
  last_name: string;
  username: string;
  password: string;
  email: string;
  timezone: string;
  team: string;
  issues: string[];
  selected?: boolean;
};

const EXPECTED_FIELDS = ['first_name', 'last_name', 'username', 'password', 'email', 'timezone', 'team'];

const HEADER_ALIASES: Record<string, keyof Omit<PreviewRow, 'rowIndex' | 'issues'>> = {
  firstname: 'first_name',
  first_name: 'first_name',
  first: 'first_name',
  lastname: 'last_name',
  last_name: 'last_name',
  last: 'last_name',
  username: 'username',
  user: 'username',
  password: 'password',
  pass: 'password',
  email: 'email',
  mail: 'email',
  timezone: 'timezone',
  tz: 'timezone',
  team: 'team',
  teamname: 'team',
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let current = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(current.trim());
      current = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(current.trim());
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
      current = '';
      continue;
    }

    current += char;
  }

  row.push(current.trim());
  if (row.some((cell) => cell !== '')) rows.push(row);

  return rows;
}

function randomToken(length: number) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let token = '';
  for (let i = 0; i < length; i += 1) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}

function makeUsername(firstName: string, lastName: string, usedUsernames?: Set<string>): string {
  // Extract only ASCII characters from names for username generation
  const firstAscii = firstName.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const lastAscii = lastName.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  
  // Build base from ASCII-only parts, fallback to "user" if empty
  let base = `${firstAscii}${lastAscii}` || 'user';
  if (base.length > 20) {
    base = base.substring(0, 20);
  }
  
  let username = `${base}${randomToken(4).toLowerCase()}`;
  
  // Ensure uniqueness within the batch
  let attempts = 0;
  while (usedUsernames?.has(username) && attempts < 100) {
    username = `${base}${randomToken(4).toLowerCase()}`;
    attempts += 1;
  }
  
  usedUsernames?.add(username);
  return username;
}

function makePassword() {
  return randomToken(14);
}

interface UserBulkCreateCsvProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  contests: Array<{ id: number; name: string }>;
}

export function UserBulkCreateCsv({ isOpen, onClose, onSuccess, contests }: UserBulkCreateCsvProps) {
  const [mounted, setMounted] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [headerWarnings, setHeaderWarnings] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [generationMode, setGenerationMode] = useState<GenerationMode>('none');
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<any | null>(null);
  const [selectedRowIndices, setSelectedRowIndices] = useState<Set<number>>(new Set());
  const [contestId, setContestId] = useState<number>(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  const placeholder = useMemo(
    () =>
      'first_name,last_name,username,password,email,timezone,team\n' +
      'John,Doe,johndoe,mySecret123,john@example.com,Asia/Bangkok,Team Alpha\n' +
      'Jane,Smith,,,jane@example.com,Asia/Bangkok,Team Beta',
    []
  );

  const downloadCsv = (filename: string, content: string) => {
    // Add UTF-8 BOM for proper Thai character encoding in Excel/LibreOffice
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
  };

  const handleDownloadTemplate = () => {
    const template =
      'first_name,last_name,username,password,email,timezone,team\n' +
      'John,Doe,johndoe,mySecret123,john@example.com,Asia/Bangkok,Team Alpha\n' +
      'Jane,Smith,,,jane@example.com,Asia/Bangkok,Team Beta\n';

    downloadCsv('users-bulk-template.csv', template);
  };

  const handleExportCreatedCredentials = () => {
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

  const handleExportSelectedPreview = () => {
    if (selectedRowIndices.size === 0) return;

    const selectedRows = previewRows.filter((row) => selectedRowIndices.has(row.rowIndex));
    const lines = ['first_name,last_name,username,password,email,timezone,team'];

    selectedRows.forEach((row) => {
      const cells = [
        `"${row.first_name.replace(/"/g, '""')}"`,
        `"${row.last_name.replace(/"/g, '""')}"`,
        `"${row.username.replace(/"/g, '""')}"`,
        `"${row.password.replace(/"/g, '""')}"`,
        `"${row.email.replace(/"/g, '""')}"`,
        `"${row.timezone.replace(/"/g, '""')}"`,
        `"${row.team.replace(/"/g, '""')}"`,
      ];
      lines.push(cells.join(','));
    });

    downloadCsv('users-selected.csv', `${lines.join('\n')}\n`);
  };

  const applyGeneration = (row: PreviewRow, mode: GenerationMode, usedUsernames?: Set<string>): PreviewRow => {
    const next = { ...row };

    if (!next.username && (mode === 'username' || mode === 'both')) {
      next.username = makeUsername(next.first_name, next.last_name, usedUsernames);
    }

    if (!next.password && (mode === 'password' || mode === 'both')) {
      next.password = makePassword();
    }

    return next;
  };

  const buildPreview = (text: string, mode: GenerationMode) => {
    const matrix = parseCsv(text);
    if (matrix.length === 0) {
      setHeaderWarnings(['CSV is empty']);
      setPreviewRows([]);
      return;
    }

    const rawHeaders = matrix[0].map((header) => header.trim());
    const mappedHeaders = rawHeaders.map((header) => HEADER_ALIASES[header.toLowerCase()] || null);

    const warnings: string[] = [];
    if (!mappedHeaders.includes('first_name')) warnings.push('Missing column: first_name (or alias firstname/first)');
    if (!mappedHeaders.includes('last_name')) warnings.push('Missing column: last_name (or alias lastname/last)');

    const unknownHeaders = rawHeaders.filter((header, index) => header && !mappedHeaders[index]);
    if (unknownHeaders.length > 0) {
      warnings.push(`Unknown columns ignored: ${unknownHeaders.join(', ')}`);
    }

    const usedUsernames = new Set<string>();
    const rows = matrix.slice(1).map((cells, rowIndex) => {
      const mapped: PreviewRow = {
        rowIndex: rowIndex + 2,
        first_name: '',
        last_name: '',
        username: '',
        password: '',
        email: '',
        timezone: '',
        team: '',
        issues: [],
        selected: false,
      };

      mappedHeaders.forEach((field, colIndex) => {
        if (!field) return;
        (mapped as any)[field] = (cells[colIndex] ?? '').trim();
      });

      const withGenerated = applyGeneration(mapped, mode, usedUsernames);

      if (!withGenerated.first_name) withGenerated.issues.push('first_name missing');
      if (!withGenerated.last_name) withGenerated.issues.push('last_name missing');
      if (!withGenerated.username) withGenerated.issues.push('username missing');
      if (!withGenerated.password) withGenerated.issues.push('password missing');

      return withGenerated;
    });

    setHeaderWarnings(warnings);
    setPreviewRows(rows);
    setSelectedRowIndices(new Set());
  };

  const handleUploadFile = (file: File | undefined) => {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = String(event.target?.result ?? '');
      setCsvText(text);
      buildPreview(text, generationMode);
    };
    reader.readAsText(file);
  };

  const regeneratePreview = (mode: GenerationMode) => {
    setGenerationMode(mode);
    buildPreview(csvText, mode);
  };

  const fillEmptyInPreview = (mode: GenerationMode) => {
    setGenerationMode(mode);
    const usedUsernames = new Set<string>();
    setPreviewRows((previousRows) =>
      previousRows.map((row) => {
        const next = { ...row };

        if (!next.username && (mode === 'username' || mode === 'both')) {
          next.username = makeUsername(next.first_name, next.last_name, usedUsernames);
        } else if (next.username) {
          usedUsernames.add(next.username);
        }

        if (!next.password && (mode === 'password' || mode === 'both')) {
          next.password = makePassword();
        }

        const nextIssues: string[] = [];
        if (!next.first_name) nextIssues.push('first_name missing');
        if (!next.last_name) nextIssues.push('last_name missing');
        if (!next.username) nextIssues.push('username missing');
        if (!next.password) nextIssues.push('password missing');
        next.issues = nextIssues;

        return next;
      })
    );
  };

  const handleSubmitBulk = async () => {
    setSubmitResult(null);
    if (previewRows.length === 0) {
      setSubmitResult({ error: 'No parsed rows to submit' });
      return;
    }

    setSubmitting(true);
    try {
      const payloadRows = previewRows.map((row) => ({
        rowIndex: row.rowIndex,
        first_name: row.first_name,
        last_name: row.last_name,
        username: row.username,
        password: row.password,
        email: row.email,
        timezone: row.timezone,
        team: row.team,
      }));

      const result = await apiClient.post('/api/users/bulk', {
        rows: payloadRows,
        generationMode,
        contestId: contestId || undefined,
      });

      setSubmitResult(result);
      if (result.success) onSuccess();
    } finally {
      setSubmitting(false);
    }
  };

  const visibleRows = previewRows.slice(0, 100);
  const rowsLeft = Math.max(previewRows.length - 100, 0);

  if (!isOpen || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-100 flex items-center justify-center overflow-hidden bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="relative z-10 w-full max-w-6xl max-h-[90vh] bg-neutral-900 border border-white/10 rounded-xl shadow-2xl flex flex-col" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <h2 className="text-xl font-bold text-white">Bulk Add Users (CSV)</h2>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg transition-colors" title="Close" aria-label="Close">
            <X className="w-5 h-5 text-neutral-400" />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-auto">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-neutral-400">
              First row must be header. Supported columns: {EXPECTED_FIELDS.join(', ')}. Team column is applied when a contest is selected.
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={handleDownloadTemplate}
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
                  onChange={(event) => handleUploadFile(event.target.files?.[0])}
                />
              </label>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-neutral-400">Contest for team mapping:</label>
            <select
              value={contestId}
              onChange={(event) => setContestId(Number(event.target.value) || 0)}
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
            onChange={(event) => setCsvText(event.target.value)}
            placeholder={placeholder}
            className="w-full h-44 overflow-auto bg-black/40 border border-white/10 rounded-lg p-3 text-sm text-white font-mono resize-none"
          />

          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => buildPreview(csvText, generationMode)}>
              <FileSpreadsheet className="w-4 h-4 mr-2" /> Parse & Preview
            </Button>
            <Button variant="ghost" onClick={() => fillEmptyInPreview('both')}>
              <Wand2 className="w-4 h-4 mr-2" /> Random Username + Password
            </Button>
            <Button variant="ghost" onClick={() => fillEmptyInPreview('username')}>
              <Wand2 className="w-4 h-4 mr-2" /> Random Username
            </Button>
            <Button variant="ghost" onClick={() => fillEmptyInPreview('password')}>
              <Wand2 className="w-4 h-4 mr-2" /> Random Password
            </Button>
          </div>

          {headerWarnings.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-300 text-xs space-y-1">
              {headerWarnings.map((warning) => (
                <div key={warning} className="flex items-center gap-2">
                  <AlertTriangle className="w-3 h-3" /> {warning}
                </div>
              ))}
            </div>
          )}

          <div className="border border-white/10 rounded-lg overflow-hidden">
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-white/5 text-neutral-300 sticky top-0 z-10">
                  <tr>
                    <th className="text-left px-2 py-2 w-8">
                      <input
                        type="checkbox"
                        title="Select all rows"
                        checked={selectedRowIndices.size > 0 && selectedRowIndices.size === previewRows.length}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedRowIndices(new Set(previewRows.map((r) => r.rowIndex)));
                          } else {
                            setSelectedRowIndices(new Set());
                          }
                        }}
                      />
                    </th>
                    <th className="text-left px-2 py-2">first_name</th>
                    <th className="text-left px-2 py-2">last_name</th>
                    <th className="text-left px-2 py-2">username</th>
                    <th className="text-left px-2 py-2">password</th>
                    <th className="text-left px-2 py-2">email</th>
                    <th className="text-left px-2 py-2">timezone</th>
                    <th className="text-left px-2 py-2">team</th>
                    <th className="text-left px-2 py-2">Issues</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-3 py-6 text-center text-neutral-500">
                        No preview rows yet
                      </td>
                    </tr>
                  ) : (
                    visibleRows.map((row) => (
                      <tr key={row.rowIndex} className={`border-t border-white/5 ${selectedRowIndices.has(row.rowIndex) ? 'bg-indigo-500/10' : ''}`}>
                        <td className="px-2 py-2 text-center">
                          <input
                            type="checkbox"
                            title={`Select row ${row.rowIndex}`}
                            checked={selectedRowIndices.has(row.rowIndex)}
                            onChange={(e) => {
                              const newSet = new Set(selectedRowIndices);
                              if (e.target.checked) {
                                newSet.add(row.rowIndex);
                              } else {
                                newSet.delete(row.rowIndex);
                              }
                              setSelectedRowIndices(newSet);
                            }}
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
                ... {rowsLeft} rows left (showing first 100)
              </div>
            )}
          </div>

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
            <div className={`rounded-lg border p-3 text-xs ${submitResult.success ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-red-500/30 bg-red-500/10 text-red-300'}`}>
              {submitResult.success ? (
                <div className="space-y-1">
                  <div>Created: {submitResult.createdCount} | Failed: {submitResult.failedCount}</div>
                  {submitResult.downloadUrl && (
                    <div className="pt-2">
                      <Button variant="ghost" onClick={handleExportCreatedCredentials}>
                        <FileSpreadsheet className="w-4 h-4 mr-2" /> Download Credentials CSV
                      </Button>
                    </div>
                  )}
                  {Array.isArray(submitResult.failed) && submitResult.failed.length > 0 && (
                    <div className="max-h-32 overflow-auto">
                      {submitResult.failed.map((failure: any) => (
                        <div key={`${failure.rowIndex}-${failure.reason}`}>Row {failure.rowIndex}: {failure.reason}</div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div>{submitResult.error || 'Bulk create failed'}</div>
              )}
            </div>
          )}
        </div>

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
    </div>,
    document.body
  );
}
