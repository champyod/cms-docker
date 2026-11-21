import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import { verifyApiPermission, apiError } from '@/lib/api-utils';
import { prisma } from '@/lib/prisma';
import { recordAudit } from '@/lib/audit';

interface SubmissionFileRow {
  filename: string;
  data: Buffer | null;
}

interface ArchiveEntry {
  name: string;
  data: Buffer;
}

interface ArchiveResult {
  buffer: Uint8Array;
  filenames: string[];
}

interface ArchiveRefusal {
  error: string;
  status: number;
}

/**
 * One server-built ZIP for a submission's files, replacing the per-file base64
 * anchor loop: one permission check, one round trip, one archive the operator
 * can open as it was submitted.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { authorized, response } = await verifyApiPermission('submission:download');
  if (!authorized) return response;

  const id = Number.parseInt((await params).id, 10);
  if (!Number.isFinite(id)) return apiError({ message: 'Invalid ID', status: 400 });

  try {
    const archive = await buildSubmissionArchive(id);
    if ('status' in archive) return apiError({ message: archive.error, status: archive.status });

    await recordAudit({
      verb: 'submission:download',
      entity: 'submission',
      entityId: String(id),
      afterValues: {
        format: 'zip',
        fileCount: archive.filenames.length,
        files: archive.filenames,
      },
      result: 'success',
    });
    return zipResponse(id, archive.buffer);
  } catch (error) {
    return apiError(error);
  }
}

async function buildSubmissionArchive(submissionId: number): Promise<ArchiveResult | ArchiveRefusal> {
  const submission = await prisma.submissions.findUnique({
    where: { id: submissionId },
    select: { id: true },
  });
  if (!submission) return { error: 'Submission not found', status: 404 };

  const rows = await loadSubmissionFileContents(submissionId);
  if (rows.length === 0) return { error: 'No stored files for this submission', status: 404 };
  // Why refuse rather than skip: an archive quietly missing a file loses the
  // submission's content without telling anyone, which is worse than no archive.
  if (rows.some((row) => row.data === null)) {
    return { error: 'Stored file content is missing for this submission', status: 500 };
  }

  return zipSubmissionFiles(rows);
}

async function loadSubmissionFileContents(submissionId: number): Promise<SubmissionFileRow[]> {
  return prisma.$queryRaw<SubmissionFileRow[]>`
    SELECT f.filename, lo_get(o.loid) AS data
    FROM files f
    LEFT JOIN fsobjects o ON o.digest = f.digest
    WHERE f.submission_id = ${submissionId}
    ORDER BY f.filename
  `;
}

async function zipSubmissionFiles(rows: readonly SubmissionFileRow[]): Promise<ArchiveResult> {
  const zip = new JSZip();
  const entries = archiveEntries(rows);
  for (const entry of entries) {
    zip.file(entry.name, entry.data as Buffer);
  }
  const buffer = await zip.generateAsync({ type: 'uint8array' });
  return { buffer, filenames: entries.map((entry) => entry.name) };
}

/** Zip-slip safety: entry names lose traversal segments and stay unique in the archive. */
function archiveEntries(rows: readonly SubmissionFileRow[]): ArchiveEntry[] {
  const taken = new Set<string>();
  return rows.map((row) => {
    const name = uniqueEntryName(safeEntryName(row.filename), taken);
    taken.add(name);
    return { name, data: row.data as Buffer };
  });
}

function safeEntryName(filename: string): string {
  const segments = filename
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.' && segment !== '..');
  return segments.join('/') === '' ? 'file' : segments.join('/');
}

function uniqueEntryName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  let attempt = 1;
  while (taken.has(`${attempt}_${name}`)) attempt += 1;
  return `${attempt}_${name}`;
}

function zipResponse(submissionId: number, buffer: Uint8Array): NextResponse {
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="submission-${submissionId}.zip"`,
      'Cache-Control': 'no-store',
    },
  });
}
