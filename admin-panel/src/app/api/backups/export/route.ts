import { NextRequest } from 'next/server';

import { apiError, verifyApiPermission } from '@/lib/api-utils';
import { exportFileName, parseExportSelection } from '@/lib/backup-export';
import { dumpArgv, openDumpStream } from '@/lib/backup-export-stream';
import { selectionNeedsLargeObjects } from '@/lib/backup-table-catalog';

const DUMP_CONTENT_TYPE = 'application/octet-stream';
const TABLES_PARAM = 'tables';
/** The dump replaces a file the caller already has a copy of, so nothing may cache it. */
const NO_STORE = 'no-store';

/**
 * Streams a selective dump to the caller and keeps nothing on the server.
 *
 * The monitor runs the same `pg_dump` a scheduled backup does, with `--stdout`, so
 * no archive, no manifest entry and no rotation are produced: the download is the
 * only copy. Gated on `backup:create`, the same key that starts a selective backup,
 * because it runs the same command on the same database.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const { authorized, response } = await verifyApiPermission('backup:create');
  if (!authorized) return response;

  const selection = parseExportSelection(req.nextUrl.searchParams.get(TABLES_PARAM));
  if (!selection.ok) return apiError({ message: selection.error, status: 400 });

  const dump = await openDumpStream(dumpArgv(selection.tables, selectionNeedsLargeObjects(selection.tables)));
  if (!dump.ok) return apiError({ message: dump.error, status: 502 });

  return new Response(dump.body, {
    status: 200,
    headers: {
      'Content-Type': DUMP_CONTENT_TYPE,
      'Content-Disposition': `attachment; filename="${exportFileName(Date.now())}"`,
      'Cache-Control': NO_STORE,
    },
  });
}
