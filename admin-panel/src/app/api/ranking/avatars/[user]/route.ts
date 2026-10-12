import fs from 'fs/promises';
import path from 'path';

import { NextRequest, NextResponse } from 'next/server';

import { IMAGE_EXTENSIONS, validateAssetSize, type ImageExtension } from '@/lib/asset-upload';
import { apiError, apiSuccess, verifyApiPermission } from '@/lib/api-utils';
import { recordAudit } from '@/lib/audit';
import { logoExtension } from '@/lib/ranking-logo';

/** The directory on the shared ranking volume the service reads faces from. */
const AVATAR_DIR = '/var/local/lib/cms/ranking/avatars';
const AVATAR_FIELD = 'avatar';
const FACE_FILE_MODE = 0o644;

/** The key becomes a filename on a volume both containers share, so it is restricted here and by the service. */
function isSafeKey(key: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(key);
}

async function removeOtherFormats(key: string, keep: ImageExtension | null): Promise<void> {
  for (const ext of IMAGE_EXTENSIONS) {
    if (keep !== null && ext === keep) continue;
    await fs.rm(path.join(AVATAR_DIR, `${key}.${ext}`), { force: true });
  }
}

/** Validates an upload into the buffer and extension a write needs, or the refusal to send. */
async function readAvatarUpload(formData: FormData): Promise<{ buffer: Buffer; ext: ImageExtension } | NextResponse> {
  const file = formData.get(AVATAR_FIELD);
  if (!(file instanceof File)) {
    return apiError({ status: 400, message: 'Missing file field "avatar"' });
  }
  const sizeError = validateAssetSize('avatar', file.size);
  if (sizeError !== null) return apiError({ status: 400, message: sizeError });

  const ext = logoExtension(file.name);
  if (ext === null) {
    return apiError({ status: 400, message: 'Unsupported format — allowed: png, jpg, jpeg, gif, bmp' });
  }
  return { buffer: Buffer.from(await file.arrayBuffer()), ext };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ user: string }> },
): Promise<NextResponse> {
  const { authorized, response } = await verifyApiPermission('ranking:update');
  if (!authorized) return response;

  try {
    const { user } = await params;
    if (!isSafeKey(user)) {
      return apiError({ status: 400, message: 'Unsupported face key' });
    }

    const upload = await readAvatarUpload(await req.formData());
    if (upload instanceof NextResponse) return upload;

    await fs.mkdir(AVATAR_DIR, { recursive: true });
    await removeOtherFormats(user, null);
    const target = path.join(AVATAR_DIR, `${user}.${upload.ext}`);
    await fs.writeFile(target, upload.buffer);
    await fs.chmod(target, FACE_FILE_MODE);
    await removeOtherFormats(user, upload.ext);

    await recordAudit({
      verb: 'ranking:update',
      entity: 'ranking',
      entityId: user,
      afterValues: { action: 'avatar-upload', ext: upload.ext },
      result: 'success',
    });
    return apiSuccess({ key: user, ext: upload.ext });
  } catch (error) {
    console.error('[ranking/avatar] POST failed', error);
    return apiError(error);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ user: string }> },
): Promise<NextResponse> {
  const { authorized, response } = await verifyApiPermission('ranking:update');
  if (!authorized) return response;

  try {
    const { user } = await params;
    if (!isSafeKey(user)) {
      return apiError({ status: 400, message: 'Unsupported face key' });
    }

    await removeOtherFormats(user, null);
    await recordAudit({
      verb: 'ranking:update',
      entity: 'ranking',
      entityId: user,
      afterValues: { action: 'avatar-delete' },
      result: 'success',
    });
    return apiSuccess({ removed: true });
  } catch (error) {
    console.error('[ranking/avatar] DELETE failed', error);
    return apiError(error);
  }
}
