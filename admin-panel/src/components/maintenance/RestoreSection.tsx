'use client';

import { useState } from 'react';
import { DatabaseZap, PlayCircle, Trash2 } from 'lucide-react';

import { deletePreview, getPreviewTables, getSampleRows, startPreview } from '@/app/actions/restore';
import { promotePreview, validatePromote } from '@/app/actions/restore-apply';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { Input } from '@/components/core/Input';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';
import { describeError, formatBytes } from '@/components/maintenance/archive-browser-helpers';
import { RestorePreviewTable, RestorePromoteGate } from '@/components/maintenance/RestorePreviewTable';
import type { SampleView } from '@/components/maintenance/RestorePreviewTable';
// Type-only: the runtime modules reach node:os through restore-preview-store and must stay out of the client bundle.
import type { TableDiffRow } from '@/lib/restore-preview';
import type { ApplyStrategies, PromoteReport, TableStrategy, ValidateReport } from '@/lib/restore-apply';

const UPLOAD_URL = '/api/backups/upload';
const UPLOAD_FIELD = 'file';
const DUMP_SUFFIX = '.dump';
/** Mirrors MAX_SAMPLE_ROWS in @/lib/restore-preview, which cannot be imported for value from a client component. */
const SAMPLE_ROW_LIMIT = 10;
/** scripts/__backup.sh names dumps cmsdb-YYYYmmdd-HHMMSS.dump, so the archive timestamp is in the file name. */
const ARCHIVE_TIMESTAMP_PATTERN = /^cmsdb-(\d{8}-\d{6})\.dump$/;

type PreviewPhase = 'idle' | 'uploading' | 'restoring' | 'measuring' | 'validating' | 'promoting' | 'deleting';

const STAGE_TEXT: Readonly<Record<Exclude<PreviewPhase, 'idle'>, string>> = {
    uploading: 'Uploading the dump to quarantine...',
    restoring: 'Starting a throwaway postgres container and restoring the dump into it. A large dump takes several minutes, and nothing is reported until the restore finishes.',
    measuring: 'Reading archive and live row counts for every catalog table...',
    validating: 'Measuring the live database against the archive. This phase only reads.',
    promoting: 'Running the pre-promote backup, then committing one transaction per table in foreign-key order. This page stays here until the run finishes or fails.',
    deleting: 'Removing the scratch container and the quarantined dump...',
};

interface Feedback { readonly tone: 'error' | 'info'; readonly message: string }
interface UploadedPreview { readonly previewId: string; readonly fileName: string; readonly sizeBytes: number }

/** Everything one preview owns, cleared in one move so a deleted preview leaves nothing behind. */
interface RunState {
    readonly rows: readonly TableDiffRow[];
    readonly warnings: readonly string[];
    readonly failures: readonly string[];
    readonly strategies: ApplyStrategies;
    readonly validate: ValidateReport | null;
    readonly promote: PromoteReport | null;
    readonly confirm: string;
    readonly sampleTable: string | null;
    readonly sampleLoading: boolean;
    readonly sample: SampleView | null;
    readonly sampleError: string | null;
}

const EMPTY_RUN: RunState = {
    rows: [], warnings: [], failures: [], strategies: {}, validate: null, promote: null,
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

function defaultStrategies(rows: readonly TableDiffRow[]): ApplyStrategies {
    return Object.fromEntries(rows.map((row) => [row.table, 'merge'] as const));
}

function NoticeList({ tone, items }: { readonly tone: 'error' | 'warning'; readonly items: readonly string[] }) {
    if (items.length === 0) return null;
    return (
        <div role={tone === 'error' ? 'alert' : 'status'} className="rounded-lg border border-border p-3">
            <Text variant="small" className={tone === 'error' ? 'text-destructive' : 'text-warning'}>{tone === 'error' ? 'Problems' : 'Warnings'}</Text>
            <ul className="list-disc pl-5 mt-1 space-y-1">
                {items.map((item) => <li key={item}><Text variant="small" color="text-muted-foreground">{item}</Text></li>)}
            </ul>
        </div>
    );
}

export function RestoreSection() {
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
            setRun({ ...EMPTY_RUN, rows: tables.tables, warnings, failures: tables.failures, strategies: defaultStrategies(tables.tables) });
        } catch (error) {
            fail(describeError(error, 'The preview could not be built.'));
        } finally {
            setPhase('idle');
        }
    };

    const handleValidate = async () => {
        if (previewId === null || isBusy) return;
        setPhase('validating');
        setFeedback(null);
        setRun((previous) => ({ ...previous, promote: null, confirm: '' }));
        try {
            const report = await validatePromote(previewId, run.strategies);
            setRunField('validate', report);
            setFeedback(report.ok
                ? { tone: 'info', message: `Validation passed for ${report.tableReports.length} table(s) against staging schema ${report.stagingSchema}.` }
                : { tone: 'error', message: 'Validation found problems, so promote stays locked until the strategies or the archive change.' });
        } catch (error) {
            fail(describeError(error, 'Validation could not be run.'));
        } finally {
            setPhase('idle');
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

    const handleStrategyChange = (table: string, strategy: TableStrategy) =>
        setRun((previous) => ({ ...previous, strategies: { ...previous.strategies, [table]: strategy }, validate: null, promote: null, confirm: '' }));

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

    const stageText = phase === 'idle'
        ? null
        : phase === 'uploading' && uploadFraction !== null
            ? `${STAGE_TEXT.uploading} ${Math.round(uploadFraction * 100)}%`
            : STAGE_TEXT[phase];
    const tableWarnings = (run.validate?.tableReports ?? []).flatMap((table) => table.warnings.map((warning) => `${table.table}: ${warning}`));
    const warnings = [...run.warnings, ...(run.validate?.warnings ?? []), ...(run.promote?.warnings ?? []), ...tableWarnings];
    const problems = [...run.failures, ...(run.validate?.errors ?? []), ...(run.promote?.errors ?? [])];

    return (
        <Card className="p-6">
            <Stack gap={6}>
                <Stack direction="row" align="center" gap={3}>
                    <div className="p-2 bg-violet-500/10 rounded-lg"><DatabaseZap className="w-5 h-5 text-violet-400" /></div>
                    <Text variant="h2" className="mr-auto">Restore From Archive</Text>
                    {archive !== null && (
                        <Button size="sm" variant="negativeOutline" icon={Trash2} loading={phase === 'deleting'} onClick={() => void handleDeletePreview()}>
                            Delete preview
                        </Button>
                    )}
                </Stack>

                <Text variant="small" color="text-muted-foreground">
                    Uploading a {DUMP_SUFFIX} quarantines it in the OS temp directory and restores it into a throwaway postgres
                    container, and the diff and the sample rows below only read from that container. Promotion is the one step
                    that writes to live, and it takes a fresh full backup before the first row.
                    {archive !== null && ` Quarantined ${archive.fileName}, ${formatBytes(archive.sizeBytes)}, preview ${archive.previewId}.`}
                </Text>

                {feedback !== null && (
                    <Text variant="small" role={feedback.tone === 'error' ? 'alert' : 'status'} aria-live="polite"
                        className={feedback.tone === 'error' ? 'text-destructive' : 'text-muted-foreground'}>
                        {feedback.message}
                    </Text>
                )}
                {stageText !== null && (
                    <Text variant="small" role="status" aria-live="polite" color="text-muted-foreground">{stageText}</Text>
                )}

                {phase === 'idle' && (
                    <Stack gap={3}>
                        <Input type="file" accept={DUMP_SUFFIX} label="Database dump (pg_dump custom format)" onChange={handleFileChange} />
                        <Button variant="positiveOutline" icon={PlayCircle} disabled={selectedFile === null} onClick={() => void handleBuildPreview()}>
                            Upload and build preview
                        </Button>
                        <Text variant="small" color="text-muted-foreground">
                            {selectedFile === null ? `Choose a ${DUMP_SUFFIX} file to begin.` : `${selectedFile.name} is ${formatBytes(selectedFile.size)}.`}
                        </Text>
                    </Stack>
                )}

                <NoticeList tone="warning" items={warnings} />
                <NoticeList tone="error" items={problems} />

                {run.rows.length > 0 && (
                    <Stack gap={4}>
                        <RestorePreviewTable
                            rows={run.rows}
                            strategies={run.strategies}
                            isLocked={isBusy}
                            sampleTable={run.sampleTable}
                            isSampleLoading={run.sampleLoading}
                            sample={run.sample}
                            sampleError={run.sampleError}
                            onStrategyChange={handleStrategyChange}
                            onViewSample={(table) => void handleViewSample(table)}
                        />
                        <RestorePromoteGate
                            isBusy={isBusy}
                            isValidating={phase === 'validating'}
                            isPromoting={phase === 'promoting'}
                            validate={run.validate}
                            promote={run.promote}
                            archiveName={archive?.fileName ?? ''}
                            confirmText={run.confirm}
                            requiredPhrase={requiredPhrase}
                            canPromote={!isBusy && run.validate?.ok === true && isConfirmed}
                            onValidate={() => void handleValidate()}
                            onPromote={() => void handlePromote()}
                            onConfirm={(value) => setRunField('confirm', value)}
                        />
                    </Stack>
                )}
            </Stack>
        </Card>
    );
}