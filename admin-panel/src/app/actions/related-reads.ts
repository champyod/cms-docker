'use server';

import { prisma } from '@/lib/prisma';
import { ensurePermission } from '@/lib/permissions';
import { recordAudit } from '@/lib/audit';

// Why this file: executables, files, tokens, user tests and permission rows
// had granted keys but no dedicated read path. Each reader below binds one
// list/read key to its table so every granted key is enforced. Submission
// results and evaluations moved to the typed evaluation read models.
// Writes stay with workers, the contest flow or the seed (see RESERVED_KEYS).

export async function getSubmissionExecutables(submissionId: number) {
  await ensurePermission('executable:list');
  return prisma.executables.findMany({
    where: { submission_id: submissionId },
    orderBy: { filename: 'asc' },
  });
}

export async function getSubmissionFiles(submissionId: number) {
  await ensurePermission('file:list');
  return prisma.files.findMany({
    where: { submission_id: submissionId },
    orderBy: { filename: 'asc' },
  });
}

export async function getSubmissionToken(submissionId: number) {
  await ensurePermission('token:list');
  return prisma.tokens.findUnique({ where: { submission_id: submissionId } });
}

export async function getParticipationUserTests(participationId: number) {
  await ensurePermission('usertest:list');
  return prisma.user_tests.findMany({
    where: { participation_id: participationId },
    orderBy: { timestamp: 'desc' },
    take: 50,
  });
}

export async function listPermissionTable() {
  await ensurePermission('permission:list');
  return prisma.permissions.findMany({ orderBy: { key: 'asc' } });
}

interface DownloadResult {
  success: boolean;
  error?: string;
  files?: Array<{ filename: string; digest: string }>;
}

/** Lists a submission's stored files for download; digests resolve via getFileByDigest. */
export async function downloadSubmissionFiles(submissionId: number): Promise<DownloadResult> {
  await ensurePermission('submission:download');
  try {
    const rows = await prisma.files.findMany({
      where: { submission_id: submissionId },
      select: { filename: true, digest: true },
    });
    await recordAudit({
      verb: 'submission:download',
      entity: 'submission',
      entityId: String(submissionId),
      afterValues: { fileCount: rows.length },
      result: 'success',
    });
    return { success: true, files: rows };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}
