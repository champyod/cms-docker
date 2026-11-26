import fs from 'fs/promises';
import path from 'path';

import { NextRequest, NextResponse } from 'next/server';

import {
  IMAGE_EXTENSIONS,
  imageMime,
  validateAssetSize,
  type ImageExtension,
} from '@/lib/asset-upload';
import { apiError, apiSuccess, verifyApiPermission } from '@/lib/api-utils';
import { fileExists, writeFileAtomic } from '@/lib/file-system';
import { getRepoRoot } from '@/lib/repo-root';
import { recordAudit } from '@/lib/audit';
import { logoExtension, logoPathValue, setLogoPath } from '@/lib/ranking-logo';
import { hostAssetsDir, rankingLibDir } from '@/lib/ranking-paths';

const LOGO_FILENAME_STEM = 'logo';
const LOGO_FILE_MODE = 0o644;

async function removeIfPresent(filePath: string): Promise<void> {
  await fs.rm(filePath, { force: true });
}

async function findFirstLogo(dir: string): Promise<{ filePath: string; ext: ImageExtension } | null> {
  for (const ext of IMAGE_EXTENSIONS) {
    const candidate = path.join(dir, `${LOGO_FILENAME_STEM}.${ext}`);
    if (await fileExists(candidate)) return { filePath: candidate, ext };
  }
  return null;
}

async function removeOtherLogos(dir: string, keepExt: ImageExtension | null): Promise<void> {
  for (const ext of IMAGE_EXTENSIONS) {
    if (keepExt !== null && ext === keepExt) continue;
    await removeIfPresent(path.join(dir, `${LOGO_FILENAME_STEM}.${ext}`));
  }
}

async function writeLogoToDir(dir: string, buffer: Buffer, ext: ImageExtension): Promise<void> {
  await writeFileAtomic(path.join(dir, `${LOGO_FILENAME_STEM}.${ext}`), buffer, LOGO_FILE_MODE);
  await removeOtherLogos(dir, ext);
}

function logoPath(): string {
  return path.join(getRepoRoot(), 'config.toml');
}

/** Points config.toml at the stored logo, or at nothing when the logo is removed. */
async function updateConfigToml(ext: ImageExtension | null): Promise<void> {
  const tomlPath = logoPath();
  let content: string;
  try {
    content = await fs.readFile(tomlPath, 'utf-8');
  } catch (error) {
    console.error(`[ranking/logo] cannot read ${tomlPath}`, error);
    throw new Error('config.toml not found');
  }
  await fs.writeFile(tomlPath, setLogoPath(content, ext), 'utf-8');
}

/**
 * The service reads the volume directory, so an upload still serves on a
 * deployment without a config.toml. Losing the pointer must not fail the upload.
 */
async function pointConfigAtLogo(ext: ImageExtension | null): Promise<void> {
  try {
    await updateConfigToml(ext);
  } catch (error) {
    console.warn('[ranking/logo] leaving config.toml alone', error);
  }
}

async function serveImageFile(filePath: string, ext: ImageExtension): Promise<NextResponse> {
  const data = await fs.readFile(filePath);
  const stat = await fs.stat(filePath);
  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: {
      'Content-Type': imageMime(ext),
      'Content-Length': String(data.length),
      'Cache-Control': 'no-store, must-revalidate',
      'Last-Modified': stat.mtime.toUTCString(),
    },
  });
}

/** The stored logo, preferring the volume the service reads over the host mirror. */
async function findStoredLogo(): Promise<{ filePath: string; ext: ImageExtension } | null> {
  const volumeLogo = await findFirstLogo(rankingLibDir());
  if (volumeLogo !== null) return volumeLogo;
  return findFirstLogo(hostAssetsDir());
}

export async function GET(): Promise<NextResponse> {
  const { authorized, response } = await verifyApiPermission('ranking:read');
  if (!authorized) return response;

  try {
    const stored = await findStoredLogo();
    if (stored === null) return apiSuccess({ exists: false, fallback: true });
    return await serveImageFile(stored.filePath, stored.ext);
  } catch (error) {
    console.error('[ranking/logo] GET failed', error);
    return apiError({ status: 500, message: 'Failed to read ranking logo' });
  }
}

interface UploadedLogo {
  readonly buffer: Buffer;
  readonly ext: ImageExtension;
}

/** Validates an upload into the buffer and extension a write needs, or the refusal to send. */
async function readLogoUpload(formData: FormData): Promise<UploadedLogo | NextResponse> {
  const file = formData.get('logo');
  if (!(file instanceof File)) {
    return apiError({ status: 400, message: 'Missing file field "logo"' });
  }
  const sizeError = validateAssetSize('logo', file.size);
  if (sizeError !== null) return apiError({ status: 400, message: sizeError });

  const ext = logoExtension(file.name || LOGO_FILENAME_STEM);
  if (ext === null) {
    return apiError({ status: 400, message: 'Unsupported format — allowed: png, jpg, jpeg, gif, bmp' });
  }
  return { buffer: Buffer.from(await file.arrayBuffer()), ext };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { authorized, response } = await verifyApiPermission('ranking:update');
  if (!authorized) return response;

  try {
    const upload = await readLogoUpload(await req.formData());
    if (upload instanceof NextResponse) return upload;

    await writeLogoToDir(rankingLibDir(), upload.buffer, upload.ext);
    await writeLogoToDir(hostAssetsDir(), upload.buffer, upload.ext);
    await pointConfigAtLogo(upload.ext);

    await recordAudit({
      verb: 'ranking:update',
      entity: 'ranking',
      afterValues: { action: 'logo-upload', ext: upload.ext },
      result: 'success',
    });
    return apiSuccess({ logoPath: logoPathValue(upload.ext), ext: upload.ext });
  } catch (error) {
    console.error('[ranking/logo] POST failed', error);
    return apiError(error);
  }
}

export async function DELETE(): Promise<NextResponse> {
  const { authorized, response } = await verifyApiPermission('ranking:update');
  if (!authorized) return response;

  try {
    await removeOtherLogos(rankingLibDir(), null);
    await removeOtherLogos(hostAssetsDir(), null);
    await pointConfigAtLogo(null);

    await recordAudit({
      verb: 'ranking:update',
      entity: 'ranking',
      afterValues: { action: 'logo-delete' },
      result: 'success',
    });
    return apiSuccess({ reverted: true });
  } catch (error) {
    console.error('[ranking/logo] DELETE failed', error);
    return apiError(error);
  }
}
