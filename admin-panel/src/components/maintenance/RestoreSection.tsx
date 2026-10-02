'use client';

import { DatabaseZap, PlayCircle, Trash2 } from 'lucide-react';

import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { Input } from '@/components/core/Input';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';
import { formatBytes } from '@/components/maintenance/archive-browser-helpers';
import { RestorePreviewTable } from '@/components/maintenance/RestorePreviewTable';
import { RestorePromoteGate } from '@/components/maintenance/RestorePreviewPanel';
import { DUMP_SUFFIX, type PreviewPhase, useRestorePreview } from '@/components/maintenance/useRestorePreview';

const STAGE_TEXT: Readonly<Record<Exclude<PreviewPhase, 'idle'>, string>> = {
    uploading: 'Uploading the dump to quarantine...',
    restoring: 'Starting a throwaway postgres container and restoring the dump into it. A large dump takes several minutes, and nothing is reported until the restore finishes.',
    measuring: 'Reading archive and live row counts for every catalog table...',
    validating: 'Measuring the live database against the archive. This phase only reads.',
    promoting: 'Running the pre-promote backup, then committing one transaction per table in foreign-key order. This page stays here until the run finishes or fails.',
    deleting: 'Removing the scratch container and the quarantined dump...',
};

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
    const {
        phase, isBusy, feedback, selectedFile, uploadFraction, archive, run, promoteProgress, recheckPromoteProgress, warnings, problems,
        requiredPhrase, canPromote, setConfirm, handleFileChange, handleBuildPreview, handleValidate,
        handlePromote, handleStrategyChange, handleViewSample, handleDeletePreview,
    } = useRestorePreview();

    const stageText = phase === 'idle'
        ? null
        : phase === 'uploading' && uploadFraction !== null
            ? `${STAGE_TEXT.uploading} ${Math.round(uploadFraction * 100)}%`
            : STAGE_TEXT[phase];

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
                            progress={promoteProgress}
                            onRecheck={recheckPromoteProgress}
                            archiveName={archive?.fileName ?? ''}
                            confirmText={run.confirm}
                            requiredPhrase={requiredPhrase}
                            canPromote={canPromote}
                            onValidate={() => void handleValidate()}
                            onPromote={() => void handlePromote()}
                            onConfirm={setConfirm}
                        />
                    </Stack>
                )}
            </Stack>
        </Card>
    );
}
