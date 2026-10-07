// Type-only: the runtime module pulls in node:fs and must stay out of the client bundle.
import type { BackupArchive } from '@/lib/backup-archives';

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
const BYTE_STEP = 1024;

export function describeError(error: unknown, fallback: string): string {
    return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

/** Mirrors sortNewestFirst in backup-archives, which stays server-side because it imports node:fs. */
export function sortNewestFirst(archives: readonly BackupArchive[]): BackupArchive[] {
    return [...archives].sort(
        (left, right) => right.modifiedAt.localeCompare(left.modifiedAt) || right.name.localeCompare(left.name),
    );
}

export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(BYTE_STEP)), BYTE_UNITS.length - 1);
    const value = bytes / BYTE_STEP ** exponent;
    return `${exponent === 0 ? value : value.toFixed(1)} ${BYTE_UNITS[exponent]}`;
}

export function formatDate(iso: string): string {
    const parsed = new Date(iso);
    return Number.isNaN(parsed.getTime()) ? 'Unknown date' : parsed.toLocaleString();
}

/** A growing dump keeps changing size and mtime, so either one proves the run reached the archive dir. */
export function archiveFingerprint(archives: readonly BackupArchive[]): string {
    const newest = archives[0];
    return newest === undefined ? 'none' : `${newest.name}:${newest.modifiedAt}:${newest.sizeBytes}`;
}