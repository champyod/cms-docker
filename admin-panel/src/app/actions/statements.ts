'use server'

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { ensurePermission, getPermissions } from '@/lib/permissions';
import { recordAudit } from '@/lib/audit';
import { stripDisallowedFields } from '@/lib/field-permissions';
import { storeFile } from '@/lib/fsobjects';

import { STATEMENT_LANGUAGES } from '@/lib/constants';
export { STATEMENT_LANGUAGES };

export async function getStatements(taskId: number) {
  await ensurePermission('statement:list');

  return prisma.statements.findMany({
    where: { task_id: taskId },
    orderBy: { language: 'asc' }
  });
}

export async function addStatement(taskId: number, language: string, fileData: string) {
  await ensurePermission('statement:create');

  try {
    const buffer = Buffer.from(fileData, 'base64');
    const digest = await storeFile(buffer);

    const permissions = await getPermissions();
    const allowed = stripDisallowedFields('statements', { language, digest }, permissions);
    if (allowed.language === undefined || allowed.digest === undefined) {
      return { success: false, error: 'Insufficient field permissions' };
    }

    await prisma.$executeRaw`
      INSERT INTO statements (task_id, language, digest)
      VALUES (${taskId}, ${allowed.language}, ${allowed.digest})
      ON CONFLICT (task_id, language)
      DO UPDATE SET digest = ${allowed.digest}
    `;

    await recordAudit({
      verb: 'statement:create',
      entity: 'statement',
      afterValues: { task_id: taskId, language: allowed.language, digest: allowed.digest },
      result: 'success',
    });
    revalidatePath('/[locale]/tasks', 'page');
    return { success: true, digest: allowed.digest };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

export async function deleteStatement(statementId: number) {
  await ensurePermission('statement:delete');

  const beforeRow = await prisma.statements.findUnique({ where: { id: statementId } });
  try {
    await prisma.statements.delete({
      where: { id: statementId }
    });
    await recordAudit({
      verb: 'statement:delete',
      entity: 'statement',
      entityId: String(statementId),
      beforeValues: beforeRow ?? undefined,
      result: 'success',
    });
    revalidatePath('/[locale]/tasks', 'page');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

export async function getAttachments(taskId: number) {
  await ensurePermission('attachment:list');

  return prisma.attachments.findMany({
    where: { task_id: taskId },
    orderBy: { filename: 'asc' }
  });
}

export async function addAttachment(taskId: number, filename: string, fileData: string) {
  await ensurePermission('attachment:create');

  try {
    const buffer = Buffer.from(fileData, 'base64');
    const digest = await storeFile(buffer);

    await prisma.$executeRaw`
      INSERT INTO attachments (task_id, filename, digest)
      VALUES (${taskId}, ${filename}, ${digest})
      ON CONFLICT (task_id, filename)
      DO UPDATE SET digest = ${digest}
    `;

    await recordAudit({
      verb: 'attachment:create',
      entity: 'attachment',
      afterValues: { task_id: taskId, filename, digest },
      result: 'success',
    });
    revalidatePath('/[locale]/tasks', 'page');
    return { success: true, digest };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

export async function deleteAttachment(attachmentId: number) {
  await ensurePermission('attachment:delete');

  const beforeRow = await prisma.attachments.findUnique({ where: { id: attachmentId } });
  try {
    await prisma.attachments.delete({
      where: { id: attachmentId }
    });
    await recordAudit({
      verb: 'attachment:delete',
      entity: 'attachment',
      entityId: String(attachmentId),
      beforeValues: beforeRow ?? undefined,
      result: 'success',
    });
    revalidatePath('/[locale]/tasks', 'page');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

export async function getFileByDigest(digest: string): Promise<{ data: string } | null> {
  await ensurePermission('fsobject:read');

  try {
    const result = await prisma.$queryRaw<{ data: Buffer }[]>`
      SELECT lo_get(loid) as data FROM fsobjects WHERE digest = ${digest}
    `;

    if (result.length === 0) return null;

    const buffer = Buffer.from(result[0].data);
    return { data: buffer.toString('base64') };
  } catch (error) {
    console.error('Failed to get file:', error);
    return null;
  }
}
