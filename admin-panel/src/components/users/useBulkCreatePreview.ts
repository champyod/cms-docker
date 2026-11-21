'use client';

import { useMemo, useState } from 'react';

import { PASSWORD_CONFIG, USERNAME_CONFIG, type GeneratorConfig } from '@/lib/credential-template';
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
  type CredentialTemplates,
  type PreviewRow,
} from './csvPreview';

export interface BulkCreatePreview {
  readonly csvText: string;
  readonly setCsvText: (value: string) => void;
  readonly headerWarnings: string[];
  readonly previewRows: PreviewRow[];
  readonly usernameTemplate: string;
  readonly setUsernameTemplate: (value: string) => void;
  readonly passwordTemplate: string;
  readonly setPasswordTemplate: (value: string) => void;
  readonly usernameConfig: GeneratorConfig;
  readonly setUsernameConfig: (config: GeneratorConfig) => void;
  readonly passwordConfig: GeneratorConfig;
  readonly setPasswordConfig: (config: GeneratorConfig) => void;
  readonly selectedRowIndices: ReadonlySet<number>;
  readonly skipInvalid: boolean;
  readonly stalePreview: boolean;
  readonly submittableRows: PreviewRow[];
  readonly blockingSelectedCount: number;
  readonly canSubmit: boolean;
  readonly confirmLabel: string;
  readonly buildPreview: (text: string) => void;
  readonly uploadFile: (file: File | undefined) => void;
  readonly fillEmptyInPreview: () => void;
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
  const [usernameTemplate, setUsernameTemplate] = useState('');
  const [passwordTemplate, setPasswordTemplate] = useState('');
  const [usernameConfig, setUsernameConfig] = useState<GeneratorConfig>(USERNAME_CONFIG);
  const [passwordConfig, setPasswordConfig] = useState<GeneratorConfig>(PASSWORD_CONFIG);
  const [selectedRowIndices, setSelectedRowIndices] = useState<Set<number>>(new Set());
  const [skipInvalid, setSkipInvalid] = useState(false);

  const templates: CredentialTemplates = {
    username: usernameTemplate,
    password: passwordTemplate,
    usernameConfig,
    passwordConfig,
  };

  const buildPreview = (text: string): void => {
    const { warnings, rows } = buildPreviewRows(text);
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
      buildPreview(text);
    };
    reader.readAsText(file);
  };

  // Why the templates are read on the call and not on the parse: filling is the reader's
  // action, so it must use the fields as they stand now, after any later edit to them.
  const fillEmptyInPreview = (): void => {
    const usedUsernames = new Set<string>();
    setPreviewRows((previousRows) => previousRows.map((row) => fillRowCredentials(row, templates, usedUsernames)));
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
    usernameTemplate,
    setUsernameTemplate,
    passwordTemplate,
    setPasswordTemplate,
    usernameConfig,
    setUsernameConfig,
    passwordConfig,
    setPasswordConfig,
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
