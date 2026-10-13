'use server'

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ensurePermission } from '@/lib/permissions';
import { auditSortOrderBy } from '@/lib/audit-sorting';
import type { ListSortInput } from '@/lib/list-sorting';
import { loadActorNames } from '@/lib/admin-names';
import { loadEntityNames, entityNameKey } from '@/lib/entity-names';
import { resolveDisplayZone, zoneDayRange } from '@/lib/timezone';

const AUDIT_PAGE_SIZE = 50;

export interface AuditLogRow {
  id: string;
  actor_id: number | null;
  actor_name: string | null;
  timestamp: string;
  verb: string;
  entity: string;
  entity_id: string | null;
  entity_name: string | null;
  result: string;
  reason: string | null;
}

export interface AuditDetailRow extends AuditLogRow {
  before_values: unknown;
  after_values: unknown;
  ip: string | null;
  session_id: string | null;
  entry_hash: string | null;
  prev_hash: string | null;
}

interface AuditLogSuccess {
  success: true;
  data: { entries: AuditLogRow[]; total: number; totalPages: number };
}

interface AuditDetailSuccess {
  success: true;
  data: AuditDetailRow;
}

interface ActionFailure {
  success: false;
  error: string;
}

export type AuditLogResult = AuditLogSuccess | ActionFailure;
export type AuditDetailResult = AuditDetailSuccess | ActionFailure;

function serializeRow(
  row: {
    id: bigint;
    actor_id: number | null;
    timestamp: Date;
    verb: string;
    entity: string;
    entity_id: string | null;
    result: string;
    reason: string | null;
  },
  actorNames: ReadonlyMap<number, string>,
  entityNames: ReadonlyMap<string, string>,
): AuditLogRow {
  return {
    id: row.id.toString(),
    actor_id: row.actor_id,
    actor_name: row.actor_id === null ? null : (actorNames.get(row.actor_id) ?? null),
    timestamp: row.timestamp.toISOString(),
    verb: row.verb,
    entity: row.entity,
    entity_id: row.entity_id,
    entity_name: row.entity_id === null ? null : (entityNames.get(entityNameKey(row.entity, row.entity_id)) ?? null),
    result: row.result,
    reason: row.reason,
  };
}

export async function getAuditLog({
  page = 1,
  pageSize = AUDIT_PAGE_SIZE,
  actorId,
  entity,
  verb,
  result,
  search,
  fromDate,
  toDate,
  sort,
}: {
  page?: number;
  pageSize?: number;
  actorId?: string;
  entity?: string;
  verb?: string;
  result?: string;
  search?: string;
  fromDate?: string;
  toDate?: string;
  sort?: ListSortInput;
}): Promise<AuditLogResult> {
  try {
    await ensurePermission('audit:read');
    await ensurePermission('audit:list');

    const where: Prisma.audit_logWhereInput = {};
    if (actorId) {
      const parsed = Number.parseInt(actorId, 10);
      if (Number.isFinite(parsed)) where.actor_id = parsed;
    }
    if (entity) where.entity = entity;
    if (verb) where.verb = { contains: verb, mode: 'insensitive' };
    if (result === 'success' || result === 'failure') where.result = result;
    if (search) {
      const contains = { contains: search, mode: 'insensitive' as const };
      where.OR = [{ verb: contains }, { reason: contains }, { entity: contains }];
    }
    if (fromDate || toDate) {
      // Why the range is built by the day helper: a date-only filter value is a day in the reader's
      // own zone (no contest owns an audit row), not a UTC midnight — `new Date(day)` reads it as
      // UTC and silently drops or adds hours for a day that is not the server's midnight.
      const dayRange = zoneDayRange(fromDate, toDate, resolveDisplayZone(null));
      if (dayRange.gte !== null && dayRange.lte !== null) {
        where.timestamp = { gte: dayRange.gte, lte: dayRange.lte };
      } else if (dayRange.gte !== null) {
        where.timestamp = { gte: dayRange.gte };
      } else if (dayRange.lte !== null) {
        where.timestamp = { lte: dayRange.lte };
      }
    }

    const skip = (page - 1) * pageSize;
    const [rows, total] = await Promise.all([
      prisma.audit_log.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: auditSortOrderBy(sort ?? null),
        select: {
          id: true,
          actor_id: true,
          timestamp: true,
          verb: true,
          entity: true,
          entity_id: true,
          result: true,
          reason: true,
        },
      }),
      prisma.audit_log.count({ where }),
    ]);
    const actorNames = await loadActorNames(
      rows.map((row) => row.actor_id).filter((id): id is number => id !== null),
    );
    const entityNames = await loadEntityNames(
      rows.map((row) => ({ entity: row.entity, entity_id: row.entity_id })),
    );

    return {
      success: true,
      data: {
        entries: rows.map((row) => serializeRow(row, actorNames, entityNames)),
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch audit log';
    return { success: false, error: message };
  }
}

export async function getDistinctEntities(): Promise<{ success: true; data: string[] } | ActionFailure> {
  try {
    await ensurePermission('audit:read');
    await ensurePermission('audit:list');
    const rows = await prisma.audit_log.findMany({
      distinct: ['entity'],
      select: { entity: true },
      orderBy: { entity: 'asc' },
    });
    return { success: true, data: rows.map((r) => r.entity) };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch entities';
    return { success: false, error: message };
  }
}

export async function getAuditEntry(id: number): Promise<AuditDetailResult> {  try {
    await ensurePermission('audit:read');
    await ensurePermission('audit:list');

    const row = await prisma.audit_log.findUnique({
      where: { id: BigInt(id) },
    });

    if (!row) {
      return { success: false, error: 'Audit entry not found' };
    }

    const actorNames = await loadActorNames(
      row.actor_id === null ? [] : [row.actor_id],
    );
    const entityNames = await loadEntityNames([{ entity: row.entity, entity_id: row.entity_id }]);

    return {
      success: true,
      data: {
        ...serializeRow(row, actorNames, entityNames),
        before_values: row.before_values,
        after_values: row.after_values,
        ip: row.ip,
        session_id: row.session_id,
        entry_hash: row.entry_hash,
        prev_hash: row.prev_hash,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch audit entry';
    return { success: false, error: message };
  }
}
