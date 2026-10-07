'use server';

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ensurePermission } from '@/lib/permissions';
import { recordAudit } from '@/lib/audit';
import { loadActorNames } from '@/lib/admin-names';

const EXPORT_ROW_LIMIT = 5000;

function escapeCsvCell(value: string | null): string {
  if (value === null) return '';
  return `"${value.replace(/"/g, '""')}"`;
}

export interface AuditExportFilters {
  actorId?: string;
  entity?: string;
  verb?: string;
  result?: string;
  search?: string;
  fromDate?: string;
  toDate?: string;
}

/** Exports the filtered log as CSV; the export itself is audited. */
export async function exportAuditLog(
  filters: AuditExportFilters,
): Promise<{ success: true; csv: string; rowCount: number } | { success: false; error: string }> {
  try {
    await ensurePermission('audit:read');
    await ensurePermission('audit:list');

    const where: Prisma.audit_logWhereInput = {};
    if (filters.actorId) {
      const parsed = Number.parseInt(filters.actorId, 10);
      if (Number.isFinite(parsed)) where.actor_id = parsed;
    }
    if (filters.entity) where.entity = filters.entity;
    if (filters.verb) where.verb = { contains: filters.verb, mode: 'insensitive' };
    if (filters.result === 'success' || filters.result === 'failure') where.result = filters.result;
    if (filters.search) {
      const contains = { contains: filters.search, mode: 'insensitive' as const };
      where.OR = [{ verb: contains }, { reason: contains }, { entity: contains }];
    }
    if (filters.fromDate || filters.toDate) {
      where.timestamp = {};
      if (filters.fromDate) where.timestamp.gte = new Date(filters.fromDate);
      if (filters.toDate) {
        const end = new Date(filters.toDate);
        end.setHours(23, 59, 59, 999);
        where.timestamp.lte = end;
      }
    }

    const rows = await prisma.audit_log.findMany({
      where,
      take: EXPORT_ROW_LIMIT,
      orderBy: { id: 'desc' },
    });
    const actorNames = await loadActorNames(
      rows.map((row) => row.actor_id).filter((id): id is number => id !== null),
    );

    const header = 'id,timestamp,actor_id,actor_name,verb,entity,entity_id,result,reason';
    const lines = rows.map((row) =>
      [
        row.id.toString(),
        row.timestamp.toISOString(),
        row.actor_id === null ? '' : String(row.actor_id),
        escapeCsvCell(row.actor_id === null ? null : (actorNames.get(row.actor_id) ?? null)),
        escapeCsvCell(row.verb),
        escapeCsvCell(row.entity),
        escapeCsvCell(row.entity_id),
        escapeCsvCell(row.result),
        escapeCsvCell(row.reason),
      ].join(','),
    );

    await recordAudit({
      verb: 'audit:export',
      entity: 'audit',
      afterValues: { rowCount: rows.length, filters },
      result: 'success',
    });
    return { success: true, csv: [header, ...lines].join('\n'), rowCount: rows.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to export audit log';
    return { success: false, error: message };
  }
}
