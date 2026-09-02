'use server'

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { ensurePermission } from '@/lib/permissions';
import { storeFile } from '@/lib/fsobjects';

import { STATEMENT_LANGUAGES } from '@/lib/constants';
export { STATEMENT_LANGUAGES };

export async function getStatements(taskId: number) {
  await ensurePermission('tasks');

  return prisma.statements.findMany({
    where: { task_id: taskId },
    orderBy: { language: 'asc' }
  });
}

export async function addStatement(taskId: number, language: string, fileData: string) {
  await ensurePermission('tasks');

  try {
    const buffer = Buffer.from(fileData, 'base64');
    const digest = await storeFile(buffer);

    await prisma.$executeRaw`
      INSERT INTO statements (task_id, language, digest)
      VALUES (${taskId}, ${language}, ${digest})
      ON CONFLICT (task_id, language)
      DO UPDATE SET digest = ${digest}
    `;

    revalidatePath('/[locale]/tasks', 'page');
    return { success: true, digest };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

export async function deleteStatement(statementId: number) {
  await ensurePermission('tasks');

  try {
    await prisma.statements.delete({
      where: { id: statementId }
    });
    revalidatePath('/[locale]/tasks', 'page');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

export async function getAttachments(taskId: number) {
  await ensurePermission('tasks');

  return prisma.attachments.findMany({
    where: { task_id: taskId },
    orderBy: { filename: 'asc' }
  });
}

export async function addAttachment(taskId: number, filename: string, fileData: string) {
  await ensurePermission('tasks');

  try {
    const buffer = Buffer.from(fileData, 'base64');
    const digest = await storeFile(buffer);

    await prisma.$executeRaw`
      INSERT INTO attachments (task_id, filename, digest)
      VALUES (${taskId}, ${filename}, ${digest})
      ON CONFLICT (task_id, filename)
      DO UPDATE SET digest = ${digest}
    `;

    revalidatePath('/[locale]/tasks', 'page');
    return { success: true, digest };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

export async function deleteAttachment(attachmentId: number) {
  await ensurePermission('tasks');

  try {
    await prisma.attachments.delete({
      where: { id: attachmentId }
    });
    revalidatePath('/[locale]/tasks', 'page');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

export async function getFileByDigest(digest: string): Promise<{ data: string } | null> {
  await ensurePermission('tasks');

  try {
    const result = await prisma.$queryRaw<{ data: Buffer }[]>`
      SELECT lo_get(lob_oid) as data FROM fsobjects WHERE digest = ${digest}
    `;

    if (result.length === 0) return null;

    const buffer = Buffer.from(result[0].data);
    return { data: buffer.toString('base64') };
  } catch (error) {
    console.error('Failed to get file:', error);
    return null;
  }
}
