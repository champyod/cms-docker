'use server';

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ensurePermission } from '@/lib/permissions';
import { recordAudit, VIEW_VERB_SUFFIX } from '@/lib/audit';
import { loadActorNames } from '@/lib/admin-names';
import { resolveDisplayZone, zoneDayRange } from '@/lib/timezone';

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
  ip?: string;
  showViews?: boolean;
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
    if (filters.ip) where.ip = { contains: filters.ip, mode: 'insensitive' };
    if (!filters.showViews) where.NOT = { verb: { endsWith: VIEW_VERB_SUFFIX } };
    if (filters.search) {
      const contains = { contains: filters.search, mode: 'insensitive' as const };
      where.OR = [{ verb: contains }, { reason: contains }, { entity: contains }];
    }
    if (filters.fromDate || filters.toDate) {
      // Why: the filter day is read in the reader's own zone, so the export covers exactly the day
      // the operator selected rather than a UTC-shifted window of it.
      const dayRange = zoneDayRange(filters.fromDate, filters.toDate, resolveDisplayZone(null));
      if (dayRange.gte !== null && dayRange.lte !== null) {
        where.timestamp = { gte: dayRange.gte, lte: dayRange.lte };
      } else if (dayRange.gte !== null) {
        where.timestamp = { gte: dayRange.gte };
      } else if (dayRange.lte !== null) {
        where.timestamp = { lte: dayRange.lte };
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

    const header = 'id,timestamp,actor_id,actor_name,ip,verb,entity,entity_id,result,reason';
    const lines = rows.map((row) =>
      [
        row.id.toString(),
        row.timestamp.toISOString(),
        row.actor_id === null ? '' : String(row.actor_id),
        escapeCsvCell(row.actor_id === null ? null : (actorNames.get(row.actor_id) ?? null)),
        escapeCsvCell(row.ip),
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
