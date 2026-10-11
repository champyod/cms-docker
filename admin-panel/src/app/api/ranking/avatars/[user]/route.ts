import fs from 'fs/promises';
import path from 'path';

import { NextRequest, NextResponse } from 'next/server';

import { IMAGE_EXTENSIONS, normalizeImageExtension, validateAssetSize } from '@/lib/asset-upload';
import { apiError, apiSuccess, verifyApiPermission } from '@/lib/api-utils';
import { recordAudit } from '@/lib/audit';

/** The directory on the shared ranking volume the service reads faces from. */
const AVATAR_DIR = '/var/local/lib/cms/ranking/avatars';

/**
 * WHY the key is restricted: it becomes a filename on a volume both containers share,
 * and the service applies the same rule before it probes — so a crafted name is refused
 * on the way in and answered with the dummy on the way out, from either side.
 */
function isSafeKey(key: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(key);
}

async function removeOtherFormats(key: string, keep: string | null): Promise<void> {
  for (const ext of IMAGE_EXTENSIONS) {
    if (keep !== null && ext === keep) continue;
    try {
      await fs.unlink(path.join(AVATAR_DIR, `${key}.${ext}`));
    } catch {
    }
  }
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

    const formData = await req.formData();
    const file = formData.get('avatar');
    if (!(file instanceof File)) {
      return apiError({ status: 400, message: 'Missing file field "avatar"' });
    }

    const sizeError = validateAssetSize('avatar', file.size);
    if (sizeError) return apiError({ status: 400, message: sizeError });

    const rawExt = file.name.includes('.') ? (file.name.split('.').pop() ?? '') : '';
    const ext = normalizeImageExtension(rawExt);
    if (!ext) {
      return apiError({ status: 400, message: 'Unsupported format — allowed: png, jpg, jpeg, gif, bmp' });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.mkdir(AVATAR_DIR, { recursive: true });
    await removeOtherFormats(user, null);
    const target = path.join(AVATAR_DIR, `${user}.${ext}`);
    await fs.writeFile(target, buffer);
    await fs.chmod(target, 0o644);
    await removeOtherFormats(user, ext);

    await recordAudit({
      verb: 'ranking:update',
      entity: 'ranking',
      entityId: user,
      afterValues: { action: 'avatar-upload', ext },
      result: 'success',
    });
    return apiSuccess({ key: user, ext });
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
