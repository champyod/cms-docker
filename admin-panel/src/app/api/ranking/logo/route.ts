import fs from 'fs/promises';
import path from 'path';

import { NextRequest, NextResponse } from 'next/server';

import { apiError, apiSuccess, verifyApiPermission } from '@/lib/api-utils';
import { getRepoRoot } from '@/lib/repo-root';

const RANKING_LIB_DIR = '/var/local/lib/cms/ranking';
const MAX_BYTES = 5 * 1024 * 1024;

const ALLOWED_EXTS = ['png', 'jpg', 'gif', 'bmp'] as const;
type AllowedExt = (typeof ALLOWED_EXTS)[number];

const MIME_MAP: Record<AllowedExt, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
};

function normalizeExt(raw: string): AllowedExt | null {
  const lower = raw.toLowerCase();
  const mapped = lower === 'jpeg' ? 'jpg' : lower;
  return (ALLOWED_EXTS as readonly string[]).includes(mapped) ? (mapped as AllowedExt) : null;
}

function mimeForExt(ext: AllowedExt): string {
  return MIME_MAP[ext];
}

async function findFirstLogo(dir: string): Promise<{ filePath: string; ext: AllowedExt } | null> {
  for (const ext of ALLOWED_EXTS) {
    const candidate = path.join(dir, `logo.${ext}`);
    try {
      await fs.access(candidate);
      return { filePath: candidate, ext };
    } catch {
      // not found, continue
    }
  }
  return null;
}

async function removeOtherLogos(dir: string, keepExt: AllowedExt | null): Promise<void> {
  for (const ext of ALLOWED_EXTS) {
    if (keepExt !== null && ext === keepExt) continue;
    const target = path.join(dir, `logo.${ext}`);
    try {
      await fs.unlink(target);
    } catch {
      // ignore missing
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
  } else if (/^\s*RANKING_PASSWORD\s*=.*$/m.test(content)) {
    content = content.replace(/^\s*RANKING_PASSWORD\s*=.*$/m, (match) => `${match}\n${newLine}`);
  } else {
    content = `${content.trimEnd()}\n${newLine}\n`;
  }

  await fs.writeFile(tomlPath, content, 'utf-8');
}

async function serveImageFile(filePath: string, ext: AllowedExt): Promise<NextResponse> {
  const data = await fs.readFile(filePath);
  const stat = await fs.stat(filePath);
  const mime = mimeForExt(ext);
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
  const { authorized, response } = await verifyApiPermission('all');
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

function extractExt(fileName: string): AllowedExt | null {
  const rawExt = fileName.includes('.') ? (fileName.split('.').pop() ?? '') : '';
  return normalizeExt(rawExt);
}

function validateFileSize(file: File): string | null {
  if (file.size === 0) return 'Empty file';
  if (file.size > MAX_BYTES) return 'File too large — max 5MB';
  return null;
}

async function writeLogoToDir(dir: string, buffer: Buffer, ext: AllowedExt): Promise<void> {
  await ensureDir(dir);
  await removeOtherLogos(dir, null);
  const target = path.join(dir, `logo.${ext}`);
  await fs.writeFile(target, buffer);
  await fs.chmod(target, 0o644);
  await removeOtherLogos(dir, ext);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { authorized, response } = await verifyApiPermission('all');
  if (!authorized) return response;

  try {
    const formData = await req.formData();
    const file = formData.get('logo');
    if (!(file instanceof File)) {
      return apiError({ status: 400, message: 'Missing file field "logo"' });
    }

    const sizeError = validateFileSize(file);
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
    return apiSuccess({ logoPath: `./config/assets/logo.${ext}`, ext });
  } catch (error) {
    console.error('[ranking/logo] POST failed', error);
    return apiError(error);
  }
}

export async function DELETE(): Promise<NextResponse> {
  const { authorized, response } = await verifyApiPermission('all');
  if (!authorized) return response;

  try {
    await removeOtherLogos(RANKING_LIB_DIR, null);

    const repoRoot = getRepoRoot();
    const hostDir = path.join(repoRoot, 'config/assets');
    await removeOtherLogos(hostDir, null);

    await updateConfigToml(null);

    return apiSuccess({ reverted: true });
  } catch (error) {
    console.error('[ranking/logo] DELETE failed', error);
    return apiError(error);
  }
}
