import { prisma } from '@/lib/prisma';

/**
 * The newest audit row for one entity, as the user and team lists read their change cursor.
 *
 * Why the audit log rather than the entity's own table: every write to those tables is audited, so
 * the log's id is a single indexed lookup, while a count of the table would miss an edit that no
 * primary key moves, and re-reading the table is exactly the poll this replaces.
 */
export async function readAuditEntityCursor(entity: string): Promise<string | null> {
  const newest = await prisma.audit_log.findFirst({
    where: { entity },
    orderBy: { id: 'desc' },
    select: { id: true },
  });
  return newest === null ? null : String(newest.id);
}
