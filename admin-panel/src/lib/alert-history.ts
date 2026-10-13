import 'server-only';

import type { Prisma } from '@prisma/client';

import { loadActorNames } from '@/lib/admin-names';
import { entityNameKey, loadEntityNames } from '@/lib/entity-names';
import { CRITICAL_AUDIT_VERBS } from '@/lib/notification-events';
import { ensurePermission } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { resolveDisplayZone, zoneDayRange } from '@/lib/timezone';

export const ALERT_PAGE_SIZE = 25;

/** One pushed alert: the audit row the bell raised, read back for the alert centre. */
export interface AlertRow {
  readonly id: string;
  readonly timestamp: string;
  readonly verb: string;
  readonly entity: string;
  readonly entity_name: string | null;
  readonly actor_name: string | null;
  readonly result: string;
}

export interface AlertHistoryQuery {
  readonly page?: number;
  readonly search?: string;
  readonly result?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
}

export type AlertHistoryResult =
  | {
      readonly success: true;
      readonly data: {
        readonly entries: AlertRow[];
        readonly total: number;
        readonly totalPages: number;
      };
    }
  | { readonly success: false; readonly error: string };

/**
 * The alert predicate, spelled out to match `isWebNotify`.
 *
 * Why it derives from the same verb set the publisher reads: the bell and the alert centre must agree
 * on what counts as an alert, or a row alerts once and then never appears in the history.
 */
function alertClause(): Prisma.audit_logWhereInput {
  return {
    OR: [
      { verb: { in: [...CRITICAL_AUDIT_VERBS] } },
      { verb: 'password:reveal', result: 'failure' },
    ],
  };
}

function buildWhere(query: AlertHistoryQuery): Prisma.audit_logWhereInput {
  const where: Prisma.audit_logWhereInput = { AND: [alertClause()] };
  if (query.result === 'success' || query.result === 'failure') where.result = query.result;
  if (query.search) {
    const contains = { contains: query.search, mode: 'insensitive' as const };
    where.OR = [{ verb: contains }, { entity: contains }, { reason: contains }];
  }
  // Why the day helper builds the range: a date-only filter value is a day in the reader's own zone,
  // and `new Date(day)` would read it as UTC midnight and shift the window by the zone offset.
  const days = zoneDayRange(query.fromDate, query.toDate, resolveDisplayZone(null));
  if (days.gte !== null || days.lte !== null) {
    where.timestamp = {
      ...(days.gte === null ? {} : { gte: days.gte }),
      ...(days.lte === null ? {} : { lte: days.lte }),
    };
  }
  return where;
}

function toAlertRow(
  row: {
    id: bigint;
    actor_id: number | null;
    timestamp: Date;
    verb: string;
    entity: string;
    entity_id: string | null;
    result: string;
  },
  actorNames: ReadonlyMap<number, string>,
  entityNames: ReadonlyMap<string, string>,
): AlertRow {
  return {
    id: row.id.toString(),
    timestamp: row.timestamp.toISOString(),
    verb: row.verb,
    entity: row.entity,
    entity_name:
      row.entity_id === null ? null : (entityNames.get(entityNameKey(row.entity, row.entity_id)) ?? null),
    actor_name: row.actor_id === null ? null : (actorNames.get(row.actor_id) ?? null),
    result: row.result,
  };
}

/**
 * A page of the alert history: the audit rows the bell raised, newest first.
 *
 * Why it reads the audit log instead of a store of its own: an alert is the audit row itself, and the
 * live service keeps only its recent backlog, so the paged history can only come from the log the
 * alerts were published from.
 */
export async function getAlertHistory(query: AlertHistoryQuery = {}): Promise<AlertHistoryResult> {
  try {
    await ensurePermission('audit:read');
    const page = Math.max(1, Math.trunc(query.page ?? 1));
    const where = buildWhere(query);
    const [rows, total] = await Promise.all([
      prisma.audit_log.findMany({
        where,
        skip: (page - 1) * ALERT_PAGE_SIZE,
        take: ALERT_PAGE_SIZE,
        orderBy: { id: 'desc' },
        select: {
          id: true,
          actor_id: true,
          timestamp: true,
          verb: true,
          entity: true,
          entity_id: true,
          result: true,
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
        entries: rows.map((row) => toAlertRow(row, actorNames, entityNames)),
        total,
        totalPages: Math.ceil(total / ALERT_PAGE_SIZE),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch alerts';
    return { success: false, error: message };
  }
}
