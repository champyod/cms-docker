'use server';

import { execFile } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { revalidatePath } from 'next/cache';

import { BACKUP_TABLES, validateTableSelection } from '@/lib/backup-table-catalog';
import type { TableSelectionResult } from '@/lib/backup-table-catalog';
import { getBackupRoot, listArchives as readArchiveFiles, resolveArchivePath } from '@/lib/backup-archives';
import type { BackupArchive } from '@/lib/backup-archives';
import { logToDiscord } from '@/lib/discord-notifier';
import { ensurePermission } from '@/lib/permissions';
import { getRepoRoot } from '@/lib/repo-root';

const execFileAsync = promisify(execFile);

const BACKUP_SCRIPT_PATH = 'scripts/__backup.sh';
const BACKUP_TIMEOUT_MS = 600_000;
const BACKUP_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const BACKUP_CONSOLE_COLOR = 16711680;
const MAINTENANCE_PAGE = '/[locale]/maintenance';
const MANIFEST_FILE = 'manifest.json';

const LARGE_OBJECT_TABLES: ReadonlySet<string> = new Set(
  BACKUP_TABLES.filter((table) => table.needsLargeObjects === true).map((table) => table.name),
);

export interface BackupManifestSummary {
  readonly ts: string;
  readonly kind: string;
  readonly tables: readonly string[];
  readonly pgVersion: string;
  readonly totalBytes: number;
}

export interface SelectiveBackupResult {
  readonly success: boolean;
  readonly message?: string;
  readonly error?: string;
  readonly warnings: readonly string[];
  readonly entry?: BackupManifestSummary;
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

/** Catalog order is parent-before-child, so it is also the order pg_dump must restore in. */
function orderSelection(tables: readonly string[]): string[] {
  const selected = new Set(tables);
  return BACKUP_TABLES.filter((table) => selected.has(table.name)).map((table) => table.name);
}

function selectionNeedsLargeObjects(tables: readonly string[]): boolean {
  return tables.some((name) => LARGE_OBJECT_TABLES.has(name));
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

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function summarizeManifestEntry(entry: Record<string, unknown>): BackupManifestSummary {
  const sizes = typeof entry.sizes === 'object' && entry.sizes !== null ? (entry.sizes as Record<string, unknown>) : {};
  return {
    ts: asString(entry.ts, ''),
    kind: asString(entry.kind, 'full'),
    tables: asStringList(entry.tables),
    pgVersion: asString(entry.pg_version, 'unknown'),
    totalBytes: typeof sizes.total_bytes === 'number' ? sizes.total_bytes : 0,
  };
}

async function readLatestManifestEntry(): Promise<BackupManifestSummary | null> {
  const raw = await readFile(path.join(getBackupRoot(), MANIFEST_FILE), 'utf8').catch(() => null);
  if (raw === null) return null;
  try {
    const entries: unknown = JSON.parse(raw);
    const latest: unknown = Array.isArray(entries) ? entries.at(-1) : undefined;
    if (typeof latest !== 'object' || latest === null) return null;
    return summarizeManifestEntry(latest as Record<string, unknown>);
  } catch (error) {
    console.error('Selective backup manifest is unreadable:', error);
    return null;
  }
}

async function runBackupScript(tables: readonly string[], includeLargeObjects: boolean): Promise<void> {
  const rootDir = getRepoRoot();
  const args = [path.join(rootDir, BACKUP_SCRIPT_PATH), '--tables', tables.join(',')];
  if (includeLargeObjects) args.push('--large-objects');
  await execFileAsync('bash', args, { cwd: rootDir, timeout: BACKUP_TIMEOUT_MS, maxBuffer: BACKUP_MAX_OUTPUT_BYTES });
}

export async function triggerSelectiveBackup(tables: string[]): Promise<SelectiveBackupResult> {
  await ensurePermission('all');
  if (!Array.isArray(tables) || !tables.every((table) => typeof table === 'string')) {
    return { success: false, error: 'Table selection must be a list of names.', warnings: [] };
  }
  const validation = validateTableSelection(tables);
  if (!validation.valid) {
    return { success: false, error: describeInvalidSelection(validation), warnings: [] };
  }
  const selection = orderSelection(tables);
  try {
    await logToDiscord('Selective Backup', `Admin triggered a selective backup of ${selection.length} table(s): ${selection.join(', ')}`);
    await runBackupScript(selection, selectionNeedsLargeObjects(selection));
  } catch (error) {
    return { success: false, error: describeFailure(error), warnings: validation.warnings };
  }
  revalidatePath(MAINTENANCE_PAGE, 'page');
  const entry = await readLatestManifestEntry();
  return {
    success: true,
    message: `Selective backup of ${selection.length} table(s) completed.`,
    warnings: validation.warnings,
    entry: entry ?? undefined,
  };
}

export async function listArchives(): Promise<ArchiveListResult> {
  await ensurePermission('all');
  try {
    return { success: true, archives: await readArchiveFiles() };
  } catch (error) {
    return { success: false, error: describeFailure(error) };
  }
}

export async function deleteArchive(name: string): Promise<ArchiveMutationResult> {
  await ensurePermission('all');
  if (typeof name !== 'string') return { success: false, error: 'Archive name must be a string.' };
  const archivePath = await resolveArchivePath(name);
  if (archivePath === null) return { success: false, error: `Archive not found: ${name}` };
  try {
    await unlink(archivePath);
  } catch (error) {
    return { success: false, error: describeFailure(error) };
  }
  // name already matched the archive allowlist, so it carries no markup or mention syntax.
  await logToDiscord('Backup Archive Deleted', `Admin deleted backup archive **${name}**.`, BACKUP_CONSOLE_COLOR);
  revalidatePath(MAINTENANCE_PAGE, 'page');
  return { success: true, message: `Deleted archive ${name}.` };
}