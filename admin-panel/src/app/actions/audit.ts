'use server'

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ensurePermission } from '@/lib/permissions';

const AUDIT_PAGE_SIZE = 50;

export interface AuditLogRow {
  id: string;
  actor_id: number | null;
  timestamp: string;
  verb: string;
  entity: string;
  entity_id: string | null;
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

function serializeRow(row: {
  id: bigint;
  actor_id: number | null;
  timestamp: Date;
  verb: string;
  entity: string;
  entity_id: string | null;
  result: string;
  reason: string | null;
}): AuditLogRow {
  return {
    id: row.id.toString(),
    actor_id: row.actor_id,
    timestamp: row.timestamp.toISOString(),
    verb: row.verb,
    entity: row.entity,
    entity_id: row.entity_id,
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
  fromDate,
  toDate,
}: {
  page?: number;
  pageSize?: number;
  actorId?: string;
  entity?: string;
  verb?: string;
  fromDate?: string;
  toDate?: string;
}): Promise<AuditLogResult> {
  try {
    await ensurePermission('audit:read');

    const where: Prisma.audit_logWhereInput = {};
    if (actorId) {
      const parsed = Number.parseInt(actorId, 10);
      if (Number.isFinite(parsed)) where.actor_id = parsed;
    }
    if (entity) where.entity = entity;
    if (verb) where.verb = { contains: verb, mode: 'insensitive' };
    if (fromDate || toDate) {
      where.timestamp = {};
      if (fromDate) where.timestamp.gte = new Date(fromDate);
      if (toDate) {
        const end = new Date(toDate);
        end.setHours(23, 59, 59, 999);
        where.timestamp.lte = end;
      }
    }

    const skip = (page - 1) * pageSize;
    const [rows, total] = await Promise.all([
      prisma.audit_log.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { id: 'desc' },
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

    return {
      success: true,
      data: {
        entries: rows.map(serializeRow),
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

export async function getAuditEntry(id: number): Promise<AuditDetailResult> {
  try {
    await ensurePermission('audit:read');

    const row = await prisma.audit_log.findUnique({
      where: { id: BigInt(id) },
    });

    if (!row) {
      return { success: false, error: 'Audit entry not found' };
    }

    return {
      success: true,
      data: {
        ...serializeRow(row),
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
