/**
 * Restore-preview identity, quarantine, upload and scratch-environment rules:
 * the preview id, the temp-directory quarantine paths, the upload name and size
 * limits, and the throwaway postgres settings the preview container runs with.
 *
 * No docker, no Prisma, no filesystem writes: everything here is decided from
 * text, numbers and paths, so the upload route and the preview server actions
 * share one definition of what a preview is allowed to be.
 */

import os from 'node:os';
import path from 'node:path';

import { isArchiveName } from '@/lib/backup-archives';

// ---------------------------------------------------------------------------
// Preview identity, quarantine and upload rules
// ---------------------------------------------------------------------------

/** Quarantine lives in the OS temp directory so an upload can never land in the backup root. */
export const PREVIEW_ROOT_DIR_NAME = 'cms-restore-preview';
export const PREVIEW_ID_PATTERN = /^[0-9a-f]{32}$/;
export const SCRATCH_IMAGE = 'postgres:15';
export const UPLOAD_MAX_BYTES_DEFAULT = 5 * 1024 * 1024 * 1024;
export const UPLOAD_SIZE_LIMIT_ENV = 'RESTORE_PREVIEW_MAX_UPLOAD_BYTES';
export const MAX_PK_SAMPLE_ROWS = 200;
export const SCRATCH_POSTGRES_USER_DEFAULT = 'cmsuser';
export const SCRATCH_POSTGRES_DB_DEFAULT = 'cmsdb';
/**
 * Fixed throwaway password for the scratch container. Nothing listens on a
 * published port and every connection is a unix socket inside the container, so
 * the live database password is never read, copied or needed here.
 */
export const SCRATCH_POSTGRES_PASSWORD = 'cms-restore-preview';

/** Operator sweep for previews nobody deleted; every container carries this name prefix. */
export const ORPHAN_SWEEP_COMMAND = 'docker ps -aq --filter name=cms-restore-preview-';

export function isPreviewId(value: unknown): value is string {
  return typeof value === 'string' && PREVIEW_ID_PATTERN.test(value);
}

export function getPreviewRoot(): string {
  return path.join(os.tmpdir(), PREVIEW_ROOT_DIR_NAME);
}

export function previewQuarantineDir(previewId: string): string {
  return path.join(getPreviewRoot(), previewId);
}

export function previewDumpPath(previewId: string, fileName: string): string {
  return path.join(previewQuarantineDir(previewId), fileName);
}

export function previewContainerName(previewId: string): string {
  return `cms-restore-preview-${previewId}`;
}

export type UploadFileNameCheck = { readonly ok: true } | { readonly ok: false; readonly message: string };

export function checkUploadFileName(name: string): UploadFileNameCheck {
  if (name.endsWith('.tar.gz')) {
    return { ok: false, message: `${name} is a volume archive, not a database dump. Preview only reads pg_dump custom-format .dump files.` };
  }
  if (!isArchiveName(name)) return { ok: false, message: 'Archive name must match the backup archive pattern.' };
  if (!name.endsWith('.dump')) {
    return { ok: false, message: `Preview needs a pg_dump custom-format .dump archive; ${name} is not one.` };
  }
  return { ok: true };
}

export function getUploadMaxBytes(): number {
  const configured = Number(process.env[UPLOAD_SIZE_LIMIT_ENV]?.trim());
  return Number.isInteger(configured) && configured > 0 ? configured : UPLOAD_MAX_BYTES_DEFAULT;
}

export interface ScratchDatabaseEnv {
  readonly POSTGRES_USER: string;
  readonly POSTGRES_PASSWORD: string;
  readonly POSTGRES_DB: string;
}

/** The user and database come from the live environment so dumped role ownership still resolves. */
export function scratchDatabaseEnv(): ScratchDatabaseEnv {
  return {
    POSTGRES_USER: process.env.POSTGRES_USER?.trim() || SCRATCH_POSTGRES_USER_DEFAULT,
    POSTGRES_PASSWORD: SCRATCH_POSTGRES_PASSWORD,
    POSTGRES_DB: process.env.POSTGRES_DB?.trim() || SCRATCH_POSTGRES_DB_DEFAULT,
  };
}