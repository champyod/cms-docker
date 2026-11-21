import { openAsBlob } from 'node:fs';
import { NextRequest } from 'next/server';
import { apiError, verifyApiPermission } from '@/lib/api-utils';
import { resolveArchivePath } from '@/lib/backup-archives';
import { resolveReadRoot } from '@/lib/backup-locations';

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

export async function GET(req: NextRequest, { params }: { params: Promise<{ name: string }> }): Promise<Response> {
  const { authorized, response } = await verifyApiPermission('backup:list');
  if (!authorized) return response;

  const { name } = await params;
  const locationId = req.nextUrl.searchParams.get('location') ?? undefined;
  const readTarget = await resolveReadRoot(locationId);
  if (!readTarget.ok) return apiError({ message: readTarget.error, status: 400 });
  const archivePath = await resolveArchivePath(name, readTarget.root);
  if (archivePath === null) return apiError({ message: 'Archive not found', status: 404 });

  return archiveDownloadResponse(await openAsBlob(archivePath), name);
}