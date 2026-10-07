import { openAsBlob } from 'node:fs';
import { NextRequest } from 'next/server';
import { apiError, verifyApiPermission } from '@/lib/api-utils';
import { resolveArchivePath } from '@/lib/backup-archives';

const ATTACHMENT_CONTENT_TYPE = 'application/octet-stream';

/**
 * The blob stays backed by the file descriptor rather than being read into the
 * heap, so a multi-gigabyte dump is served without buffering it in memory.
 * `name` already matched the archive allowlist, so it cannot break the header.
 */
function archiveDownloadResponse(blob: Blob, name: string): Response {
  return new Response(blob, {
    headers: {
      'content-type': ATTACHMENT_CONTENT_TYPE,
      'content-length': String(blob.size),
      'content-disposition': `attachment; filename="${name}"`,
      'cache-control': 'no-store',
    },
  });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ name: string }> }): Promise<Response> {
  const { authorized, response } = await verifyApiPermission('backup:list');
  if (!authorized) return response;

  const { name } = await params;
  const archivePath = await resolveArchivePath(name);
  if (archivePath === null) return apiError({ message: 'Archive not found', status: 404 });

  return archiveDownloadResponse(await openAsBlob(archivePath), name);
}