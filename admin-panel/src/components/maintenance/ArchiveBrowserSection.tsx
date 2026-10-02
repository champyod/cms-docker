'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, Download, RefreshCw, Trash2 } from 'lucide-react';

import { deleteArchive, listArchives } from '@/app/actions/backups';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { EmptyState } from '@/components/core/EmptyState';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';
// Type-only: the runtime module pulls in node:fs and must stay out of the client bundle.
import type { BackupArchive } from '@/lib/backup-archives';

export interface ArchiveBrowserSectionProps {
    readonly refreshToken: number;
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
const BYTE_STEP = 1024;

/** Bounded backoff: a selective dump is started detached, so the archive appears later. */
const POLL_BACKOFF_MS: readonly number[] = [2_000, 4_000, 8_000];

type BackupWatchState = 'idle' | 'waiting' | 'timedOut';

const BACKUP_WATCH_MESSAGE: Readonly<Record<Exclude<BackupWatchState, 'idle'>, string>> = {
    waiting: 'Backup is running in the background. Checking for the new archive...',
    timedOut: 'Backup is still running in the background. It can take several minutes — use Refresh to check again.',
};

function describeError(error: unknown, fallback: string): string {
    return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

/** Mirrors sortNewestFirst in backup-archives, which stays server-side because it imports node:fs. */
function sortNewestFirst(archives: readonly BackupArchive[]): BackupArchive[] {
    return [...archives].sort(
        (left, right) => right.modifiedAt.localeCompare(left.modifiedAt) || right.name.localeCompare(left.name),
    );
}

function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(BYTE_STEP)), BYTE_UNITS.length - 1);
    const value = bytes / BYTE_STEP ** exponent;
    return `${exponent === 0 ? value : value.toFixed(1)} ${BYTE_UNITS[exponent]}`;
}

function formatDate(iso: string): string {
    const parsed = new Date(iso);
    return Number.isNaN(parsed.getTime()) ? 'Unknown date' : parsed.toLocaleString();
}

/** A growing dump keeps changing size and mtime, so either one proves the run reached the archive dir. */
function archiveFingerprint(archives: readonly BackupArchive[]): string {
    const newest = archives[0];
    return newest === undefined ? 'none' : `${newest.name}:${newest.modifiedAt}:${newest.sizeBytes}`;
}

export function ArchiveBrowserSection({ refreshToken }: ArchiveBrowserSectionProps) {
    const [archives, setArchives] = useState<readonly BackupArchive[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [deletingName, setDeletingName] = useState<string | null>(null);
    const [backupWatch, setBackupWatch] = useState<BackupWatchState>('idle');
    const knownArchivesRef = useRef<readonly BackupArchive[]>([]);
    const isMountedRef = useRef(true);
    const isFirstLoadRef = useRef(true);
    const pollGenerationRef = useRef(0);
    const cancelPollDelayRef = useRef<(() => void) | null>(null);

    const loadArchives = useCallback(async () => {
        setIsLoading(true);
        setLoadError(null);
        try {
            const result = await listArchives();
            if (result.success) {
                const sorted = sortNewestFirst(result.archives ?? []);
                knownArchivesRef.current = sorted;
                setArchives(sorted);
            } else {
                setArchives([]);
                setLoadError(result.error ?? 'Could not read the backup archive list.');
            }
        } catch (error) {
            setArchives([]);
            setLoadError(describeError(error, 'Could not read the backup archive list.'));
        } finally {
            setIsLoading(false);
        }
    }, []);

    const waitForPollDelay = useCallback(
        (ms: number): Promise<void> =>
            new Promise((resolve) => {
                const timer = setTimeout(resolve, ms);
                cancelPollDelayRef.current = () => {
                    clearTimeout(timer);
                    resolve();
                };
            }),
        [],
    );

    const stopPolling = useCallback(() => {
        pollGenerationRef.current += 1;
        cancelPollDelayRef.current?.();
        cancelPollDelayRef.current = null;
    }, []);

    const pollForNewArchive = useCallback(
        async (baseline: string) => {
            const generation = pollGenerationRef.current + 1;
            pollGenerationRef.current = generation;
            setBackupWatch('waiting');
            try {
                for (const delayMs of POLL_BACKOFF_MS) {
                    await waitForPollDelay(delayMs);
                    if (pollGenerationRef.current !== generation) return;
                    const result = await listArchives().catch(() => null);
                    if (result === null || !result.success) continue;
                    const sorted = sortNewestFirst(result.archives ?? []);
                    if (archiveFingerprint(sorted) === baseline) continue;
                    knownArchivesRef.current = sorted;
                    setArchives(sorted);
                    setBackupWatch('idle');
                    return;
                }
                setBackupWatch('timedOut');
            } finally {
                cancelPollDelayRef.current = null;
            }
        },
        [waitForPollDelay],
    );

    useEffect(() => () => {
        isMountedRef.current = false;
    }, []);

    useEffect(() => {
        const baseline = archiveFingerprint(knownArchivesRef.current);
        const isFirstLoad = isFirstLoadRef.current;
        isFirstLoadRef.current = false;
        void (async () => {
            await loadArchives();
            if (isFirstLoad || !isMountedRef.current) return;
            await pollForNewArchive(baseline);
        })();
        return stopPolling;
    }, [loadArchives, pollForNewArchive, refreshToken, stopPolling]);

    const handleDelete = async (name: string) => {
        if (!confirm(`Delete backup archive ${name}? This cannot be undone.`)) return;
        setDeletingName(name);
        setNotice(null);
        try {
            const result = await deleteArchive(name);
            if (result.success) {
                setNotice(result.message ?? `Deleted archive ${name}.`);
                await loadArchives();
            } else {
                setNotice(result.error ?? `Could not delete ${name}.`);
            }
        } catch (error) {
            setNotice(describeError(error, `Could not delete ${name}.`));
        } finally {
            setDeletingName(null);
        }
    };

    return (
        <Card className="p-6">
            <Stack gap={6}>
                <Stack direction="row" align="center" gap={3}>
                    <div className="p-2 bg-sky-500/10 rounded-lg">
                        <Archive className="w-5 h-5 text-sky-400" />
                    </div>
                    <Text variant="h2" className="mr-auto">
                        Backup Archives
                    </Text>
                    <Button
                        size="sm"
                        variant="secondary"
                        icon={RefreshCw}
                        loading={isLoading}
                        onClick={() => void loadArchives()}
                    >
                        Refresh
                    </Button>
                </Stack>

                {backupWatch !== 'idle' && (
                    <Text variant="small" role="status" aria-live="polite" className="text-amber-400">
                        {BACKUP_WATCH_MESSAGE[backupWatch]}
                    </Text>
                )}

                {loadError !== null ? (
                    <Text variant="small" role="alert" className="text-destructive">
                        {loadError}
                    </Text>
                ) : isLoading ? (
                    <Text variant="small" color="text-muted-foreground">
                        Loading archives...
                    </Text>
                ) : archives.length === 0 ? (
                    <EmptyState
                        icon={Archive}
                        title="No backup archives yet"
                        description="Run a selective backup or a scheduled full backup, then refresh to see the archive here."
                    />
                ) : (
                    <ul className="divide-y divide-border rounded-lg border border-border">
                        {archives.map((archive) => (
                            <li key={archive.name} className="flex items-center gap-3 px-3 py-2">
                                <div className="min-w-0 mr-auto">
                                    <p className="text-sm text-white font-mono truncate">{archive.name}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {formatBytes(archive.sizeBytes)} &middot; {archive.kind} &middot; {formatDate(archive.modifiedAt)}
                                    </p>
                                </div>
                                <a
                                    href={`/api/backups/${encodeURIComponent(archive.name)}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-sm font-medium text-primary hover:bg-primary/10 transition-colors shrink-0"
                                >
                                    <Download className="size-4 shrink-0" />
                                    Download
                                </a>
                                <Button
                                    size="sm"
                                    variant="negativeOutline"
                                    icon={Trash2}
                                    loading={deletingName === archive.name}
                                    onClick={() => void handleDelete(archive.name)}
                                >
                                    Delete
                                </Button>
                            </li>
                        ))}
                    </ul>
                )}

                {notice !== null && (
                    <Text variant="small" role="status" aria-live="polite" className="text-muted-foreground">
                        {notice}
                    </Text>
                )}
            </Stack>
        </Card>
    );
}
