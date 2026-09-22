import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';

export type AuditResult = 'success' | 'failure';

export interface AuditEntry {
  verb: string;
  entity: string;
  entityId?: string;
  beforeValues?: unknown;
  afterValues?: unknown;
  reason?: string;
  result: AuditResult;
  actorId?: number;
  ip?: string;
  sessionId?: string;
}

export const DESTRUCTIVE_VERB_KEYWORDS: readonly string[] = [
  'delete',
  'reset',
  'clean',
  'remove',
  'drop',
  'overwrite',
  'revoke',
  'rotate',
  'restart',
  'redeploy',
  'shutdown',
];

export function isDestructiveVerb(verb: string): boolean {
  const normalized = verb.trim().toLowerCase();
  if (normalized.length === 0) {
    return false;
  }
  return DESTRUCTIVE_VERB_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

export function assertReasonForDestructive(
  verb: string,
  reason?: string,
): { ok: true } | { ok: false; error: string } {
  if (!isDestructiveVerb(verb)) {
    return { ok: true };
  }
  if (reason !== undefined && reason.trim().length > 0) {
    return { ok: true };
  }
  return { ok: false, error: `A reason is required for the destructive action "${verb}"` };
}

export function computeEntryHash(previousHash: string | null, canonicalPayload: string): string {
  return createHash('sha256').update(`${previousHash ?? ''}|${canonicalPayload}`).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const nested = record[key];
    if (nested === undefined) {
      continue;
    }
    parts.push(`${JSON.stringify(key)}:${stableStringify(nested)}`);
  }
  return `{${parts.join(',')}}`;
}

export function canonicaliseEntry(entry: AuditEntry): string {
  return stableStringify(entry);
}

function jsonInput(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined ? undefined : (value as Prisma.InputJsonValue);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Publishes one named frame for a freshly written audit row: web bell when the
 * row is push-worthy, Discord only when it is sensitive. Name lookups fall back
 * to `#id` text, and the whole step never throws, so alerting can neither
 * duplicate nor break logging.
 */
async function publishFrame(
  entry: AuditEntry,
  actorId: number | null,
  rowId: bigint,
  timestamp: Date,
): Promise<void> {
  try {
    const { classifyAuditEventWithNames, isDiscordNotify } = await import('@/lib/notification-events');
    const { prisma } = await import('@/lib/prisma');
    let actorName = 'system';
    if (actorId !== null) {
      const admin = await prisma.admins.findUnique({ where: { id: actorId }, select: { name: true, username: true } });
      actorName = admin?.name ?? admin?.username ?? `admin #${actorId}`;
    }
    let targetName = entry.entityId === undefined ? entry.entity : `${entry.entity} #${entry.entityId}`;
    if (entry.entityId !== undefined && ['deployment', 'contest'].includes(entry.entity)) {
      const contest = await prisma.contests.findUnique({ where: { id: Number(entry.entityId) }, select: { name: true } });
      if (contest) targetName = contest.name;
    }
    if (entry.entityId !== undefined && entry.entity === 'admin') {
      const target = await prisma.admins.findUnique({ where: { id: Number(entry.entityId) }, select: { name: true, username: true } });
      if (target) targetName = target.name ?? target.username;
    }
    const framed = classifyAuditEventWithNames(entry.verb, entry.result, actorName, targetName);
    if (framed !== null) {
      const { publishNotification } = await import('@/lib/notification-queue');
      publishNotification({ ...framed, id: `audit-${String(rowId)}`, timestamp: timestamp.toISOString() });
    }
    if (isDiscordNotify(entry.verb, entry.result)) {
      const { logToDiscord } = await import('@/lib/discord-notifier');
      const detail = framed?.detail ?? `${actorName} ran ${entry.verb} on ${targetName}`;
      void logToDiscord(`Critical admin action: ${entry.verb}`, `${detail} (${entry.result})`, 15158332, true);
    }
  } catch {
    return;
  }
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    const { getSession } = await import('@/lib/auth');
    const { prisma } = await import('@/lib/prisma');

    let actorId = entry.actorId;
    if (actorId === undefined) {
      const session = await getSession();
      if (session) {
        const parsedActorId = Number.parseInt(session.userId, 10);
        if (Number.isFinite(parsedActorId)) {
          actorId = parsedActorId;
        }
      }
    }

    const previous = await prisma.audit_log.findFirst({
      orderBy: { id: 'desc' },
      select: { entry_hash: true },
    });
    // Why: chaining each row to the previous entry_hash makes the log tamper-evident — editing or dropping any row breaks every later hash.
    const previousHash = previous?.entry_hash ?? null;
    const entryHash = computeEntryHash(previousHash, canonicaliseEntry(entry));

    const created = await prisma.audit_log.create({
      data: {
        actor_id: actorId ?? null,
        verb: entry.verb,
        entity: entry.entity,
        entity_id: entry.entityId ?? null,
        before_values: jsonInput(entry.beforeValues),
        after_values: jsonInput(entry.afterValues),
        reason: entry.reason ?? null,
        ip: entry.ip ?? null,
        session_id: entry.sessionId ?? null,
        result: entry.result,
        entry_hash: entryHash,
        prev_hash: previousHash,
      },
    });

    await publishFrame(entry, actorId ?? null, created.id, created.timestamp);
  } catch (error) {
    const { logToDiscord } = await import('@/lib/discord-notifier');
    await logToDiscord(
      'Audit log write failed',
      `${entry.entity}:${entry.verb} — ${describeError(error)}`,
      15158332,
      true,
    );
  }
}
