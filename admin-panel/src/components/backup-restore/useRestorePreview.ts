'use client';

import { useState } from 'react';

import { deletePreview, getPreviewTables, getSampleRows, startPreview } from '@/app/actions/restore';
import { promotePreview, validatePromote } from '@/app/actions/restore-apply';
import { resolvePreviewConflict } from '@/app/actions/restore-apply-resolve';
import type { ConflictResolution } from '@/app/actions/restore-apply-resolve';
import { describeError } from '@/components/backup-restore/archive-browser-helpers';
import type { ConflictChoice } from '@/components/backup-restore/RestoreConflictDialog';
import type { SampleView } from '@/components/backup-restore/RestorePreviewTable';
import { usePromoteProgress } from '@/components/backup-restore/usePromoteProgress';
// The leaf module, not the `@/lib/restore-apply` barrel: the barrel reaches
// `node:os` through the preview store and cannot be bundled for the browser.
import { buildRestoreStrategies, displayValues } from '@/lib/restore-apply-conflicts';
import type { AccountUsernameConflict, RestoreConflict, RestoreMode, UniqueValueConflict } from '@/lib/restore-apply-conflicts';
// Type-only: the runtime modules reach node:os through restore-preview-store and must stay out of the client bundle.
import type { TableDiffRow } from '@/lib/restore-preview';
import type { ApplyStrategies, PromoteReport, TableStrategy, ValidateReport } from '@/lib/restore-apply';

export { PROMOTE_PROGRESS_WINDOW_MS } from '@/components/backup-restore/usePromoteProgress';

const UPLOAD_URL = '/api/backups/upload';
const UPLOAD_FIELD = 'file';
export const DUMP_SUFFIX = '.dump';
/** Mirrors MAX_SAMPLE_ROWS in @/lib/restore-preview, which cannot be imported for value from a client component. */
const SAMPLE_ROW_LIMIT = 10;
/** scripts/__backup.sh names dumps cmsdb-YYYYmmdd-HHMMSS.dump, so the archive timestamp is in the file name. */
const ARCHIVE_TIMESTAMP_PATTERN = /^cmsdb-(\d{8}-\d{6})\.dump$/;

export type PreviewPhase = 'idle' | 'uploading' | 'restoring' | 'measuring' | 'validating' | 'resolving' | 'promoting' | 'deleting';

export interface Feedback { readonly tone: 'error' | 'info'; readonly message: string }
export interface UploadedPreview { readonly previewId: string; readonly fileName: string; readonly sizeBytes: number }

/** Everything one preview owns, cleared in one move so a deleted preview leaves nothing behind. */
export interface RunState {
    readonly rows: readonly TableDiffRow[];
    readonly warnings: readonly string[];
    readonly failures: readonly string[];
    /** The tables the operator picked; every other table is sent as 'skip' so it is never applied. */
    readonly selection: readonly string[];
    readonly strategies: ApplyStrategies;
    readonly modeOpen: boolean;
    readonly validate: ValidateReport | null;
    readonly promote: PromoteReport | null;
    readonly confirm: string;
    readonly sampleTable: string | null;
    readonly sampleLoading: boolean;
    readonly sample: SampleView | null;
    readonly sampleError: string | null;
}

const EMPTY_RUN: RunState = {
    rows: [], warnings: [], failures: [], selection: [], strategies: {}, modeOpen: false, validate: null, promote: null,
    confirm: '', sampleTable: null, sampleLoading: false, sample: null, sampleError: null,
};

/**
 * XHR rather than fetch, because fetch cannot report how much of a multi-gigabyte
 * body has reached the server and this is the only step with a real progress figure.
 */
function uploadDump(file: File, onProgress: (fraction: number) => void): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        const form = new FormData();
        form.append(UPLOAD_FIELD, file);
        request.open('POST', UPLOAD_URL);
        request.upload.addEventListener('progress', (event) => {
            if (event.lengthComputable) onProgress(event.loaded / event.total);
        });
        request.addEventListener('load', () => {
            try {
                resolve(JSON.parse(request.responseText) as unknown);
            } catch {
                reject(new Error(`The upload endpoint answered ${request.status} without a JSON body.`));
            }
        });
        request.addEventListener('error', () => reject(new Error('The upload request could not reach the server.')));
        request.addEventListener('abort', () => reject(new Error('The upload was aborted before it finished.')));
        request.send(form);
    });
}

type UploadOutcome =
    | { readonly ok: true; readonly preview: UploadedPreview }
    | { readonly ok: false; readonly message: string };

/** The upload route answers with apiSuccess or apiError, so a preview id is what tells the two apart. */
function readUploadOutcome(body: unknown): UploadOutcome {
    if (typeof body !== 'object' || body === null) return { ok: false, message: 'The upload endpoint returned an unreadable body.' };
    const record = body as Record<string, unknown>;
    if (typeof record.previewId !== 'string' || typeof record.fileName !== 'string') {
        const message = record.error;
        return { ok: false, message: typeof message === 'string' && message.length > 0 ? message : 'The upload was refused without a usable preview id.' };
    }
    return {
        ok: true,
        preview: {
            previewId: record.previewId,
            fileName: record.fileName,
            sizeBytes: typeof record.sizeBytes === 'number' ? record.sizeBytes : 0,
        },
    };
}

function confirmationPhrase(archiveName: string): string {
    return ARCHIVE_TIMESTAMP_PATTERN.exec(archiveName)?.[1] ?? archiveName;
}

/** The tables an archive actually carries, which is the set worth applying by default. */
function defaultSelection(rows: readonly TableDiffRow[]): readonly string[] {
    return rows.filter((row) => row.archivePresent).map((row) => row.table);
}

/**
 * The whole selection at one strategy, with everything unselected sent as `skip`.
 *
 * The omitted tables have to be named explicitly: a table absent from the record
 * is read as the default strategy, not as skipped, so leaving them out would apply
 * tables the operator never picked.
 */
function strategiesFor(rows: readonly TableDiffRow[], selection: readonly string[], mode: RestoreMode): ApplyStrategies {
    const chosen = buildRestoreStrategies(selection, mode);
    return Object.fromEntries(rows.map((row) => [row.table, chosen[row.table] ?? 'skip'] as const));
}

/** Where the conflicting archive row is, and the live row it collides with. */
interface ConflictTarget {
    readonly keyValues: readonly string[];
    readonly liveValues: readonly string[];
    readonly column: string;
    readonly currentValue: string;
}

/** Only the row-level conflicts have a target: an overwrite-parent one is answered by what happens to the tables. */
function conflictTarget(conflict: UniqueValueConflict | AccountUsernameConflict): ConflictTarget {
    if (conflict.kind === 'account-username') {
        return {
            keyValues: [String(conflict.pair.stagedId)],
            liveValues: [String(conflict.pair.liveId)],
            column: 'username',
            currentValue: conflict.pair.username,
        };
    }
    return {
        keyValues: conflict.stagedKey,
        liveValues: conflict.liveKey,
        column: conflict.columns[0] ?? '',
        currentValue: displayValues(conflict.values),
    };
}

function conflictCurrentValue(conflict: RestoreConflict | null): string {
    return conflict === null || conflict.kind === 'fk-overwrite' ? '' : conflictTarget(conflict).currentValue;
}

export function useRestorePreview() {
    const [phase, setPhase] = useState<PreviewPhase>('idle');
    const [feedback, setFeedback] = useState<Feedback | null>(null);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [uploadFraction, setUploadFraction] = useState<number | null>(null);
    const [archive, setArchive] = useState<UploadedPreview | null>(null);
    const [run, setRun] = useState<RunState>(EMPTY_RUN);

    const isBusy = phase !== 'idle';
    const previewId = archive?.previewId ?? null;
    const requiredPhrase = archive === null ? '' : confirmationPhrase(archive.fileName);
    const isConfirmed = requiredPhrase.length > 0 && run.confirm.trim() === requiredPhrase;
    const setRunField = <K extends keyof RunState>(key: K, value: RunState[K]) => setRun((previous) => ({ ...previous, [key]: value }));
    const fail = (message: string) => { setFeedback({ tone: 'error', message }); setPhase('idle'); };

    /** A fresh measurement invalidates the gate and any confirmation typed against the previous one. */
    const recordValidation = (report: ValidateReport) => setRun((previous) => ({ ...previous, validate: report, promote: null, confirm: '' }));

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const chosen = event.target.files?.[0] ?? null;
        setSelectedFile(chosen);
        setFeedback(null);
        if (chosen !== null && !chosen.name.toLowerCase().endsWith(DUMP_SUFFIX)) {
            setSelectedFile(null);
            setFeedback({ tone: 'error', message: `${chosen.name} is not a ${DUMP_SUFFIX} file. Preview only reads pg_dump custom-format archives, and the upload route checks the name and the size cap again.` });
        }
    };

    const handleBuildPreview = async () => {
        if (selectedFile === null || isBusy) return;
        setFeedback(null);
        setUploadFraction(null);
        setPhase('uploading');
        try {
            // A new upload replaces the current preview, so its container and dump go first rather than orphaning them.
            if (previewId !== null) await deletePreview(previewId);
            const body = await uploadDump(selectedFile, setUploadFraction);
            const outcome = readUploadOutcome(body);
            if (!outcome.ok) { fail(outcome.message); return; }
            const uploaded = outcome.preview;
            setArchive(uploaded);
            // A new preview invalidates every measurement, gate and confirmation the previous one produced.
            setRun(EMPTY_RUN);
            setPhase('restoring');
            const started = await startPreview(uploaded.previewId);
            if (!started.started) {
                fail(`${started.error ?? 'The preview could not start.'} The quarantined dump is kept, so you can retry or delete the preview.`);
                return;
            }
            setPhase('measuring');
            const tables = await getPreviewTables(uploaded.previewId);
            const warnings = [...started.warnings, ...tables.warnings];
            if (!tables.success) { fail(tables.error ?? 'Could not read the preview tables.'); return; }
            setRun({ ...EMPTY_RUN, rows: tables.tables, warnings, failures: tables.failures, selection: defaultSelection(tables.tables) });
        } catch (error) {
            fail(describeError(error, 'The preview could not be built.'));
        } finally {
            setPhase('idle');
        }
    };

    /** Validates under a given record and reports what the report means for the open prompts. */
    const validateUnder = async (strategies: ApplyStrategies): Promise<void> => {
        if (previewId === null) return;
        setPhase('validating');
        const report = await validatePromote(previewId, strategies);
        recordValidation(report);
        setFeedback(report.ok
            ? { tone: 'info', message: `Validation passed for ${report.tableReports.length} table(s) against staging schema ${report.stagingSchema}.` }
            : { tone: 'error', message: report.conflicts.length > 0
                ? `${report.conflicts.length} conflict(s) need a decision before this can be promoted; they are asked about one at a time.`
                : 'Validation found problems, so promote stays locked until the strategies or the archive change.' });
        setPhase('idle');
    };

    const handleToggleTable = (table: string) => {
        if (isBusy) return;
        setRun((previous) => {
            const chosen = previous.selection.includes(table)
                ? previous.selection.filter((entry) => entry !== table)
                : [...previous.selection, table];
            // A changed selection invalidates the previous report, so the gate closes until it is measured again.
            return { ...previous, selection: chosen, validate: null, promote: null, confirm: '' };
        });
    };

    const handleOpenMode = () => {
        if (previewId === null || isBusy || run.selection.length === 0) return;
        setFeedback(null);
        setRunField('modeOpen', true);
    };

    const handleDismissMode = () => setRunField('modeOpen', false);

    const handleChooseMode = async (mode: RestoreMode) => {
        if (previewId === null || isBusy) return;
        const strategies = strategiesFor(run.rows, run.selection, mode);
        setRun((previous) => ({ ...previous, modeOpen: false, strategies, validate: null, promote: null, confirm: '' }));
        try {
            await validateUnder(strategies);
        } catch (error) {
            fail(describeError(error, 'Validation could not be run.'));
        }
    };

    /**
     * Answers the conflict at the head of the queue and measures again.
     *
     * The report is the queue: whichever conflicts it still carries are the ones
     * left, so nothing has to track which have been answered and a resolution that
     * changes more than it claimed is caught by the next measurement.
     */
    const handleResolveConflict = async (choice: ConflictChoice) => {
        const conflict = run.validate?.conflicts[0] ?? null;
        if (conflict === null || previewId === null || isBusy) return;
        // An overwrite-parent conflict is answered by what happens to the tables, so
        // anything else offered for it is refused rather than read as one of the two.
        if (conflict.kind === 'fk-overwrite') {
            if (choice.action !== 'merge-table' && choice.action !== 'skip-table') return;
            const strategy: TableStrategy = choice.action === 'merge-table' ? 'merge' : 'skip';
            const strategies = { ...run.strategies, [conflict.table]: strategy };
            setRun((previous) => ({ ...previous, strategies, validate: null, promote: null, confirm: '' }));
            try {
                await validateUnder(strategies);
            } catch (error) {
                fail(describeError(error, 'Validation could not be run.'));
            }
            return;
        }
        // A row-level conflict is answered on its rows, so a strategy change offered
        // for one is refused rather than read as a regenerate.
        if (choice.action === 'merge-table' || choice.action === 'skip-table') return;
        setPhase('resolving');
        setFeedback(null);
        try {
            const target = conflictTarget(conflict);
            const resolution: ConflictResolution = choice.action === 'keep-live'
                ? { action: 'keep-live' }
                : choice.action === 'take-archive'
                    ? { action: 'take-archive', toValues: target.liveValues }
                    : { action: 'autogenerate', column: choice.column.length > 0 ? choice.column : target.column, value: choice.value };
            const result = await resolvePreviewConflict({ previewId, table: conflict.table, keyValues: target.keyValues, resolution });
            if (!result.success) { fail(result.error ?? 'The resolution could not be applied.'); return; }
            await validateUnder(run.strategies);
        } catch (error) {
            fail(describeError(error, 'The resolution could not be applied.'));
        } finally {
            setPhase((current) => (current === 'resolving' ? 'idle' : current));
        }
    };

    const handlePromote = async () => {
        if (previewId === null || run.validate === null || run.validate.ok !== true || !isConfirmed || isBusy) return;
        setPhase('promoting');
        setFeedback(null);
        try {
            const report = await promotePreview(previewId, run.strategies, run.validate.reportId);
            setRunField('promote', report);
            setFeedback(report.ok
                ? { tone: 'info', message: 'The restore is committed to the live database and was reported to Discord.' }
                : { tone: 'error', message: 'The promote stopped. Read the per-table records below before re-running anything.' });
        } catch (error) {
            fail(describeError(error, 'The promote could not be completed.'));
        } finally {
            setPhase('idle');
        }
    };

    const handleViewSample = async (table: string) => {
        if (previewId === null) return;
        setRun((previous) => ({ ...previous, sampleTable: table, sample: null, sampleError: null, sampleLoading: true }));
        try {
            const result = await getSampleRows(previewId, table, SAMPLE_ROW_LIMIT);
            if (result.success) setRunField('sample', { table: result.table, columns: result.columns, rows: result.rows });
            else setRunField('sampleError', result.error ?? `Could not read sample rows for ${table}.`);
        } catch (error) {
            setRunField('sampleError', describeError(error, `Could not read sample rows for ${table}.`));
        } finally {
            setRunField('sampleLoading', false);
        }
    };

    const handleDeletePreview = async () => {
        if (previewId === null || isBusy) return;
        if (!confirm(`Remove preview ${previewId}? Its scratch container and its quarantined dump are deleted, and the uploaded archive cannot be recovered afterwards.`)) return;
        setPhase('deleting');
        setFeedback(null);
        try {
            const result = await deletePreview(previewId);
            setRun(EMPTY_RUN);
            setSelectedFile(null);
            if (result.success) setArchive(null);
            setFeedback({ tone: result.success ? 'info' : 'error', message: result.message ?? result.error ?? 'The preview was removed.' });
        } catch (error) {
            fail(describeError(error, 'The preview could not be removed.'));
        } finally {
            setPhase('idle');
        }
    };

    const currentConflict = run.validate?.conflicts[0] ?? null;
    const tableWarnings = (run.validate?.tableReports ?? []).flatMap((table) => table.warnings.map((warning) => `${table.table}: ${warning}`));
    const { progress: promoteProgress, recheck: recheckPromoteProgress } = usePromoteProgress(phase === 'promoting', previewId, run.validate?.reportId ?? null);

    return {
        phase, isBusy, feedback, selectedFile, uploadFraction, archive, run, promoteProgress, recheckPromoteProgress,
        warnings: [...run.warnings, ...(run.validate?.warnings ?? []), ...(run.promote?.warnings ?? []), ...tableWarnings],
        problems: [...run.failures, ...(run.validate?.errors ?? []), ...(run.promote?.errors ?? [])],
        currentConflict,
        currentConflictValue: conflictCurrentValue(currentConflict),
        requiredPhrase, canPromote: !isBusy && run.validate?.ok === true && isConfirmed,
        setConfirm: (value: string) => setRunField('confirm', value),
        handleFileChange, handleBuildPreview, handleToggleTable, handleOpenMode, handleDismissMode, handleChooseMode,
        handleResolveConflict, handlePromote, handleViewSample, handleDeletePreview,
    };
}
