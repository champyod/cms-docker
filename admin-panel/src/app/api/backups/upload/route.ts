import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';

import { NextRequest } from 'next/server';

import { apiError, apiSuccess, verifyApiPermission } from '@/lib/api-utils';
import {
  checkUploadFileName,
  getUploadMaxBytes,
  isPreviewId,
  previewDumpPath,
  previewQuarantineDir,
} from '@/lib/restore-preview';

const UPLOAD_FIELD = 'file';
const QUARANTINE_DIR_MODE = 0o700;
const QUARANTINE_FILE_MODE = 0o600;

/** The quarantine is always the OS temp directory, never BACKUP_DIR: an upload is not an archive. */
function newPreviewId(): string {
  const candidate = randomUUID().replaceAll('-', '');
  if (!isPreviewId(candidate)) throw new Error('Generated preview id does not match the preview id pattern.');
  return candidate;
}

function readUploadedFile(formData: FormData): File | null {
  const value = formData.get(UPLOAD_FIELD);
  return value instanceof File ? value : null;
}

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** Reads the request body chunk by chunk and stops the moment the cap is passed. */
async function* guardedChunks(file: File, maxBytes: number): AsyncGenerator<Uint8Array> {
  const reader = file.stream().getReader();
  let written = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return;
      written += chunk.value.byteLength;
      if (written > maxBytes) throw new Error(`Upload exceeds the ${formatBytes(maxBytes)} preview limit.`);
      yield chunk.value;
    }
  } catch (error) {
    await reader.cancel(error);
    throw error;
  }
}

/**
 * Streams the upload to quarantine and enforces the size cap while writing, so a
 * misreported part length cannot fill the temp volume. A rejected upload leaves
 * no file and no directory behind.
 */
async function writeQuarantineFile(file: File, previewId: string): Promise<void> {
  const target = previewDumpPath(previewId, file.name);
  await mkdir(previewQuarantineDir(previewId), { recursive: true, mode: QUARANTINE_DIR_MODE });
  try {
    await pipeline(
      Readable.from(guardedChunks(file, getUploadMaxBytes())),
      createWriteStream(target, { mode: QUARANTINE_FILE_MODE, flags: 'w' }),
    );
  } catch (error) {
    await rm(previewQuarantineDir(previewId), { recursive: true, force: true });
    throw error;
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const { authorized, response } = await verifyApiPermission('backup:restore');
  if (!authorized) return response;

  try {
    const formData = await req.formData();
    const file = readUploadedFile(formData);
    if (file === null) return apiError({ message: `Send the dump as the "${UPLOAD_FIELD}" form field.`, status: 400 });

    const nameCheck = checkUploadFileName(file.name);
    if (!nameCheck.ok) return apiError({ message: nameCheck.message, status: 400 });

    const maxBytes = getUploadMaxBytes();
    if (file.size > maxBytes) {
      return apiError({ message: `Dump is larger than the ${formatBytes(maxBytes)} preview limit.`, status: 413 });
    }

    const previewId = newPreviewId();
    await writeQuarantineFile(file, previewId);
    return apiSuccess({
      previewId,
      fileName: file.name,
      sizeBytes: file.size,
      quarantineDir: previewQuarantineDir(previewId),
      maxUploadBytes: maxBytes,
      next: 'startPreview',
    });
  } catch (error) {
    return apiError(error);
  }
}