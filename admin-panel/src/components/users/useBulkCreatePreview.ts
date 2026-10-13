'use client';

import { useMemo, useState } from 'react';

import {
  blockingRowIndices,
  buildConfirmLabel,
  countSelectedBlocking,
  isPreviewStale,
  selectableRowIndices,
  selectSubmittableRows,
} from './bulkCreateState';
import {
  buildPreviewRows,
  fillRowCredentials,
  type GenerationMode,
  type PreviewRow,
} from './csvPreview';

export interface BulkCreatePreview {
  readonly csvText: string;
  readonly setCsvText: (value: string) => void;
  readonly headerWarnings: string[];
  readonly previewRows: PreviewRow[];
  readonly generationMode: GenerationMode;
  readonly selectedRowIndices: ReadonlySet<number>;
  readonly skipInvalid: boolean;
  readonly stalePreview: boolean;
  readonly submittableRows: PreviewRow[];
  readonly blockingSelectedCount: number;
  readonly canSubmit: boolean;
  readonly confirmLabel: string;
  readonly buildPreview: (text: string, mode: GenerationMode) => void;
  readonly uploadFile: (file: File | undefined) => void;
  readonly fillEmptyInPreview: (mode: GenerationMode) => void;
  readonly toggleRow: (rowIndex: number, checked: boolean) => void;
  readonly selectAll: (checked: boolean) => void;
  readonly toggleSkipInvalid: () => void;
}

/** Owns the parsed draft, its selection, and the gates that decide whether it may be created. */
export function useBulkCreatePreview(): BulkCreatePreview {
  const [csvText, setCsvText] = useState('');
  const [parsedText, setParsedText] = useState('');
  const [headerWarnings, setHeaderWarnings] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [generationMode, setGenerationMode] = useState<GenerationMode>('none');
  const [selectedRowIndices, setSelectedRowIndices] = useState<Set<number>>(new Set());
  const [skipInvalid, setSkipInvalid] = useState(false);

  const buildPreview = (text: string, mode: GenerationMode): void => {
    const { warnings, rows } = buildPreviewRows(text, mode);
    setHeaderWarnings(warnings);
    setPreviewRows(rows);
    // A fresh parse selects every row, since the checkboxes are the create set.
    setSelectedRowIndices(selectableRowIndices(rows));
    setParsedText(text);
    setSkipInvalid(false);
  };

  const uploadFile = (file: File | undefined): void => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = String(event.target?.result ?? '');
      setCsvText(text);
      buildPreview(text, generationMode);
    };
    reader.readAsText(file);
  };

  const fillEmptyInPreview = (mode: GenerationMode): void => {
    setGenerationMode(mode);
    const usedUsernames = new Set<string>();
    setPreviewRows((previousRows) => previousRows.map((row) => fillRowCredentials(row, mode, usedUsernames)));
  };

  const toggleRow = (rowIndex: number, checked: boolean): void => {
    setSelectedRowIndices((previous) => {
      const next = new Set(previous);
      if (checked) next.add(rowIndex);
      else next.delete(rowIndex);
      return next;
    });
  };

  const selectAll = (checked: boolean): void => {
    setSelectedRowIndices(checked ? selectableRowIndices(previewRows) : new Set());
  };

  const toggleSkipInvalid = (): void => {
    setSkipInvalid((previous) => !previous);
  };

  const blockingIndices = useMemo(() => blockingRowIndices(previewRows), [previewRows]);
  const stalePreview = isPreviewStale(csvText, parsedText);
  const submittableRows = useMemo(
    () => selectSubmittableRows(previewRows, selectedRowIndices, skipInvalid, blockingIndices),
    [previewRows, selectedRowIndices, skipInvalid, blockingIndices],
  );
  const blockingSelectedCount = useMemo(
    () => countSelectedBlocking(previewRows, selectedRowIndices, blockingIndices),
    [previewRows, selectedRowIndices, blockingIndices],
  );
  const canSubmit = !stalePreview && submittableRows.length > 0 && (skipInvalid || blockingSelectedCount === 0);
  const confirmLabel = buildConfirmLabel(stalePreview, submittableRows.length, previewRows.length);

  return {
    csvText,
    setCsvText,
    headerWarnings,
    previewRows,
    generationMode,
    selectedRowIndices,
    skipInvalid,
    stalePreview,
    submittableRows,
    blockingSelectedCount,
    canSubmit,
    confirmLabel,
    buildPreview,
    uploadFile,
    fillEmptyInPreview,
    toggleRow,
    selectAll,
    toggleSkipInvalid,
  };
}
