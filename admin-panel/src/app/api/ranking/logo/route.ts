import fs from 'fs/promises';
import path from 'path';

import { NextRequest, NextResponse } from 'next/server';

import {
  IMAGE_EXTENSIONS,
  imageMime,
  normalizeImageExtension,
  validateAssetSize,
  type ImageExtension,
} from '@/lib/asset-upload';
import { apiError, apiSuccess, verifyApiPermission } from '@/lib/api-utils';
import { getRepoRoot } from '@/lib/repo-root';
import { recordAudit } from '@/lib/audit';

const RANKING_LIB_DIR = '/var/local/lib/cms/ranking';

async function findFirstLogo(dir: string): Promise<{ filePath: string; ext: ImageExtension } | null> {
  for (const ext of IMAGE_EXTENSIONS) {
    const candidate = path.join(dir, `logo.${ext}`);
    try {
      await fs.access(candidate);
      return { filePath: candidate, ext };
    } catch {
    }
  }
  return null;
}

async function removeOtherLogos(dir: string, keepExt: ImageExtension | null): Promise<void> {
  for (const ext of IMAGE_EXTENSIONS) {
    if (keepExt !== null && ext === keepExt) continue;
    const target = path.join(dir, `logo.${ext}`);
    try {
      await fs.unlink(target);
    } catch {
    }
  }
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function updateConfigToml(ext: string | null): Promise<void> {
  const repoRoot = getRepoRoot();
  const tomlPath = path.join(repoRoot, 'config.toml');
  let content: string;
  try {
    content = await fs.readFile(tomlPath, 'utf-8');
  } catch (error) {
    console.error('[ranking/logo] failed to read config.toml', error);
    throw new Error('config.toml not found');
  }

  const newValue = ext ? `"./config/assets/logo.${ext}"` : '""';
  const newLine = `RANKING_LOGO_PATH = ${newValue}`;

  if (/^\s*RANKING_LOGO_PATH\s*=.*$/m.test(content)) {
    content = content.replace(/^\s*RANKING_LOGO_PATH\s*=.*$/m, newLine);
  } else if (/^\s*RANKING_SESSION_SECRET\s*=.*$/m.test(content)) {
    content = content.replace(/^\s*RANKING_SESSION_SECRET\s*=.*$/m, (match) => `${match}\n${newLine}`);
  } else {
    content = `${content.trimEnd()}\n${newLine}\n`;
  }

  await fs.writeFile(tomlPath, content, 'utf-8');
}

async function serveImageFile(filePath: string, ext: ImageExtension): Promise<NextResponse> {
  const data = await fs.readFile(filePath);
  const stat = await fs.stat(filePath);
  const mime = imageMime(ext);
  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Length': String(data.length),
      'Cache-Control': 'no-store, must-revalidate',
      'Last-Modified': stat.mtime.toUTCString(),
    },
  });
}

export async function GET(): Promise<NextResponse> {
  const { authorized, response } = await verifyApiPermission('ranking:read');
  if (!authorized) return response;

  try {
    const volumeLogo = await findFirstLogo(RANKING_LIB_DIR);
    if (volumeLogo) {
      return await serveImageFile(volumeLogo.filePath, volumeLogo.ext);
    }

    const repoRoot = getRepoRoot();
    const hostDir = path.join(repoRoot, 'config/assets');
    const hostLogo = await findFirstLogo(hostDir);
    if (hostLogo) {
      return await serveImageFile(hostLogo.filePath, hostLogo.ext);
    }

    return apiSuccess({ exists: false, fallback: true });
  } catch (error) {
    console.error('[ranking/logo] GET failed', error);
    return apiError({ status: 500, message: 'Failed to read ranking logo' });
  }
}

function extractExt(fileName: string): ImageExtension | null {
  const rawExt = fileName.includes('.') ? (fileName.split('.').pop() ?? '') : '';
  return normalizeImageExtension(rawExt);
}

async function writeLogoToDir(dir: string, buffer: Buffer, ext: ImageExtension): Promise<void> {
  await ensureDir(dir);
  await removeOtherLogos(dir, null);
  const target = path.join(dir, `logo.${ext}`);
  await fs.writeFile(target, buffer);
  await fs.chmod(target, 0o644);
  await removeOtherLogos(dir, ext);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { authorized, response } = await verifyApiPermission('ranking:update');
  if (!authorized) return response;

  try {
    const formData = await req.formData();
    const file = formData.get('logo');
    if (!(file instanceof File)) {
      return apiError({ status: 400, message: 'Missing file field "logo"' });
    }

    const sizeError = validateAssetSize('logo', file.size);
    if (sizeError) return apiError({ status: 400, message: sizeError });

    const ext = extractExt(file.name || 'logo');
    if (!ext) {
      return apiError({ status: 400, message: 'Unsupported format — allowed: png, jpg, jpeg, gif, bmp' });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeLogoToDir(RANKING_LIB_DIR, buffer, ext);

    const repoRoot = getRepoRoot();
    const hostDir = path.join(repoRoot, 'config/assets');
    await writeLogoToDir(hostDir, buffer, ext);

    await updateConfigToml(ext);
    await recordAudit({
      verb: 'ranking:update',
      entity: 'ranking',
      afterValues: { action: 'logo-upload', ext },
      result: 'success',
    });
    return apiSuccess({ logoPath: `./config/assets/logo.${ext}`, ext });
  } catch (error) {
    console.error('[ranking/logo] POST failed', error);
    return apiError(error);
  }
}

export async function DELETE(): Promise<NextResponse> {
  const { authorized, response } = await verifyApiPermission('ranking:update');
  if (!authorized) return response;

  try {
    await removeOtherLogos(RANKING_LIB_DIR, null);

    const repoRoot = getRepoRoot();
    const hostDir = path.join(repoRoot, 'config/assets');
    await removeOtherLogos(hostDir, null);

    await updateConfigToml(null);

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
