'use server'

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import crypto from 'crypto';

import { STATEMENT_LANGUAGES } from '@/lib/constants';
export { STATEMENT_LANGUAGES };

// Calculate SHA256 digest
function calculateDigest(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

// Store file in fsobjects table (CMS file storage system)
async function storeFile(data: Buffer): Promise<string> {
  const digest = calculateDigest(data);
  
  // Check if file already exists
  const existing = await prisma.$queryRaw<any[]>`
    SELECT digest FROM fsobjects WHERE digest = ${digest}
  `;
  
  if (existing.length === 0) {
    // Store the file using PostgreSQL Large Object
    // First create a large object and get the OID
    const result = await prisma.$queryRaw<any[]>`
      SELECT lo_from_bytea(0, ${data}::bytea) as lob_oid
    `;
    const lobOid = result[0].lob_oid;
    
    // Insert into fsobjects table
    await prisma.$executeRaw`
      INSERT INTO fsobjects (digest, lob_oid, description)
      VALUES (${digest}, ${lobOid}, 'Uploaded via Admin Panel')
    `;
  }
  
  return digest;
}

// Get statements for a task
export async function getStatements(taskId: number) {
  return prisma.statements.findMany({
    where: { task_id: taskId },
    orderBy: { language: 'asc' }
  });
}

// Add a statement
export async function addStatement(taskId: number, language: string, fileData: string) {
  try {
    // Decode base64 file data
    const buffer = Buffer.from(fileData, 'base64');
    
    // Store file and get digest
    const digest = await storeFile(buffer);
    
    // Create or update statement
    await prisma.$executeRaw`
      INSERT INTO statements (task_id, language, digest)
      VALUES (${taskId}, ${language}, ${digest})
      ON CONFLICT (task_id, language) 
      DO UPDATE SET digest = ${digest}
    `;
    
    revalidatePath('/[locale]/tasks');
    return { success: true, digest };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

// Delete a statement
export async function deleteStatement(statementId: number) {
  try {
    await prisma.statements.delete({
      where: { id: statementId }
    });
    revalidatePath('/[locale]/tasks');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

// Get attachments for a task
export async function getAttachments(taskId: number) {
  return prisma.attachments.findMany({
    where: { task_id: taskId },
    orderBy: { filename: 'asc' }
  });
}

// Add an attachment
export async function addAttachment(taskId: number, filename: string, fileData: string) {
  try {
    // Decode base64 file data
    const buffer = Buffer.from(fileData, 'base64');
    
    // Store file and get digest
    const digest = await storeFile(buffer);
    
    // Create or update attachment
    await prisma.$executeRaw`
      INSERT INTO attachments (task_id, filename, digest)
      VALUES (${taskId}, ${filename}, ${digest})
      ON CONFLICT (task_id, filename) 
      DO UPDATE SET digest = ${digest}
    `;
    
    revalidatePath('/[locale]/tasks');
    return { success: true, digest };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

// Delete an attachment
export async function deleteAttachment(attachmentId: number) {
  try {
    await prisma.attachments.delete({
      where: { id: attachmentId }
    });
    revalidatePath('/[locale]/tasks');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

// Download file by digest
export async function getFileByDigest(digest: string): Promise<{ data: string } | null> {
  try {
    const result = await prisma.$queryRaw<any[]>`
      SELECT lo_get(lob_oid) as data FROM fsobjects WHERE digest = ${digest}
    `;
    
    if (result.length === 0) return null;
    
    // Convert binary to base64
    const buffer = Buffer.from(result[0].data);
    return { data: buffer.toString('base64') };
  } catch (error) {
    console.error('Failed to get file:', error);
    return null;
  }
}
