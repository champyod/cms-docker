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

    await prisma.audit_log.create({
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

    // Why fire-and-forget here: one audit row produces exactly one dispatch decision,
    // and the Discord helper never throws, so alerting can neither duplicate nor break logging.
    const { isCriticalAuditEvent } = await import('@/lib/notification-events');
    if (isCriticalAuditEvent(entry.verb, entry.result)) {
      const { logToDiscord } = await import('@/lib/discord-notifier');
      const target = entry.entityId === undefined ? entry.entity : `${entry.entity} #${entry.entityId}`;
      const actor = actorId === undefined || actorId === null ? 'system' : `admin #${actorId}`;
      void logToDiscord(
        `Critical admin action: ${entry.verb}`,
        `${actor} ran ${entry.verb} on ${target} (${entry.result})`,
        15158332,
        true,
      );
    }
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
