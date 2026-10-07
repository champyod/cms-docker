'use server';

import { execFile } from 'node:child_process';
import { unlink } from 'node:fs/promises';
import { promisify } from 'node:util';
import { revalidatePath } from 'next/cache';

import { orderSelection, selectionNeedsLargeObjects, validateTableSelection } from '@/lib/backup-table-catalog';
import type { TableSelectionResult } from '@/lib/backup-table-catalog';
import { listArchives as readArchiveFiles, resolveArchivePath } from '@/lib/backup-archives';
import type { BackupArchive } from '@/lib/backup-archives';
import { resolveReadRoot, resolveWriteRoot } from '@/lib/backup-locations';
import { logToDiscord } from '@/lib/discord-notifier';
import { ensurePermission } from '@/lib/permissions';

const execFileAsync = promisify(execFile);

const MONITOR_CONTAINER = 'cms-monitor';
const MONITOR_BACKUP_SCRIPT = '/usr/local/bin/cms-backup.sh';
const BACKUP_START_TIMEOUT_MS = 30_000;
const BACKUP_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const BACKUP_CONSOLE_COLOR = 16711680;
/** The page the backup actions revalidate after a run. */
const BACKUP_RESTORE_PAGE = '/[locale]/system/backup-restore';

/**
 * The dump is handed to cms-monitor detached, so this resolves the moment the
 * container accepts the run rather than when the archive exists. No manifest
 * entry is reported: any entry readable at that moment belongs to an older run.
 */
export interface SelectiveBackupResult {
  readonly success: boolean;
  readonly started: boolean;
  readonly message?: string;
  readonly error?: string;
  readonly warnings: readonly string[];
}

export interface ArchiveListResult {
  readonly success: boolean;
  readonly archives?: readonly BackupArchive[];
  readonly error?: string;
}

export interface ArchiveMutationResult {
  readonly success: boolean;
  readonly message?: string;
  readonly error?: string;
}

function describeInvalidSelection(validation: TableSelectionResult): string {
  if (validation.unknown.length > 0) return `Not in the backup table catalog: ${validation.unknown.join(', ')}`;
  return validation.warnings[0] ?? 'No tables selected.';
}

function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) return 'Backup failed.';
  const stderr = 'stderr' in error && typeof error.stderr === 'string' ? error.stderr.trim() : '';
  return stderr.length > 0 ? `${error.message}: ${stderr}` : error.message;
}

async function startBackupInMonitor(tables: readonly string[], includeLargeObjects: boolean, writeRoot: string | null): Promise<void> {
  const args = ['exec', '-d', MONITOR_CONTAINER, 'bash', MONITOR_BACKUP_SCRIPT, '--tables', tables.join(',')];
  if (includeLargeObjects) args.push('--large-objects');
  if (writeRoot !== null) args.push('--root', writeRoot);
  await execFileAsync('docker', args, { timeout: BACKUP_START_TIMEOUT_MS, maxBuffer: BACKUP_MAX_OUTPUT_BYTES });
}

export async function triggerSelectiveBackup(tables: string[], locationId?: string): Promise<SelectiveBackupResult> {
  await ensurePermission('backup:create');
  if (!Array.isArray(tables) || !tables.every((table) => typeof table === 'string')) {
    return { success: false, started: false, error: 'Table selection must be a list of names.', warnings: [] };
  }
  const validation = validateTableSelection(tables);
  if (!validation.valid) {
    return { success: false, started: false, error: describeInvalidSelection(validation), warnings: [] };
  }
  const writeTarget = resolveWriteRoot(locationId);
  if (!writeTarget.ok) {
    return { success: false, started: false, error: writeTarget.error, warnings: validation.warnings };
  }
  const selection = orderSelection(tables);
  try {
    await logToDiscord('Selective Backup', `Admin triggered a selective backup of ${selection.length} table(s): ${selection.join(', ')}`);
    await startBackupInMonitor(selection, selectionNeedsLargeObjects(selection), writeTarget.root);
  } catch (error) {
    return { success: false, started: false, error: describeFailure(error), warnings: validation.warnings };
  }
  revalidatePath(BACKUP_RESTORE_PAGE, 'page');
  return {
    success: true,
    started: true,
    message: `Selective backup of ${selection.length} table(s) started in the background on ${MONITOR_CONTAINER}. Follow the Discord channel for the result, or wait for the new dump to appear in the archive list.`,
    warnings: validation.warnings,
  };
}

export async function listArchives(locationId?: string): Promise<ArchiveListResult> {
  await ensurePermission('backup:list');
  const readTarget = resolveReadRoot(locationId);
  if (!readTarget.ok) return { success: false, error: readTarget.error };
  try {
    return { success: true, archives: await readArchiveFiles(readTarget.root) };
  } catch (error) {
    return { success: false, error: describeFailure(error) };
  }
}

export async function deleteArchive(name: string, locationId?: string): Promise<ArchiveMutationResult> {
  await ensurePermission('backup:delete');
  if (typeof name !== 'string') return { success: false, error: 'Archive name must be a string.' };
  const readTarget = resolveReadRoot(locationId);
  if (!readTarget.ok) return { success: false, error: readTarget.error };
  const archivePath = await resolveArchivePath(name, readTarget.root);
  if (archivePath === null) return { success: false, error: `Archive not found: ${name}` };
  try {
    await unlink(archivePath);
  } catch (error) {
    return { success: false, error: describeFailure(error) };
  }
  // name already matched the archive allowlist, so it carries no markup or mention syntax.
  await logToDiscord('Backup Archive Deleted', `Admin deleted backup archive **${name}**.`, BACKUP_CONSOLE_COLOR);
  revalidatePath(BACKUP_RESTORE_PAGE, 'page');
  return { success: true, message: `Deleted archive ${name}.` };
}