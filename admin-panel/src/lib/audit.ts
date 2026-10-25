import type { Prisma } from '@prisma/client';
import { resolveClientIp } from '@/lib/request-identity';
import { canonicaliseAuditRow, computeEntryHash, stableStringify, type AuditRowPayload } from '@/lib/audit-chain';

// The digest and the canonical form live in lib/audit-chain.ts, which the operator verifier
// (scripts/audit-log.ts) imports too. Re-exported here so the panel's existing callers and tests
// keep one import site.
export { computeEntryHash };

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

export const VIEW_VERB_SUFFIX = ':view';

/** Whether a verb is a page load rather than an action that changed state. */
export function isPageViewVerb(verb: string): boolean {
  return verb.endsWith(VIEW_VERB_SUFFIX);
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
    const { classifyAuditEventWithNames, isDiscordNotify, isWebNotify } = await import('@/lib/notification-events');
    const web = isWebNotify(entry.verb, entry.result);
    const discord = isDiscordNotify(entry.verb, entry.result);
    if (!web && !discord) return;
    const { prisma } = await import('@/lib/prisma');
    let actorName = 'system';
    if (actorId !== null) {
      const admin = await prisma.admins.findUnique({ where: { id: actorId }, select: { name: true, username: true } });
      actorName = admin?.name ?? admin?.username ?? `admin #${actorId}`;
    }
    const numericId = entry.entityId === undefined ? null : Number(entry.entityId);
    const targetId = numericId !== null && Number.isFinite(numericId) ? numericId : null;
    let targetName = entry.entityId === undefined ? entry.entity : `${entry.entity} #${entry.entityId}`;
    if (targetId !== null && ['deployment', 'contest'].includes(entry.entity)) {
      const contest = await prisma.contests.findUnique({ where: { id: targetId }, select: { name: true } });
      if (contest) targetName = contest.name;
    }
    if (targetId !== null && entry.entity === 'admin') {
      const target = await prisma.admins.findUnique({ where: { id: targetId }, select: { name: true, username: true } });
      if (target) targetName = target.name ?? target.username;
    }
    const framed = classifyAuditEventWithNames(entry.verb, entry.result, actorName, targetName);
    if (framed !== null) {
      const { publishNotification } = await import('@/lib/notification-queue');
      publishNotification({ ...framed, id: `audit-${String(rowId)}`, timestamp: timestamp.toISOString() });
    }
    if (!discord) return;
    const { logToDiscord } = await import('@/lib/discord-notifier');
    const detail = framed?.detail ?? `${actorName} ran ${entry.verb} on ${targetName}`;
    void logToDiscord(`Critical admin action: ${entry.verb}`, `${detail} (${entry.result})`, 15158332, true);
  } catch {
    return;
  }
}

interface AuditRequestContext {
  readonly ip: string | null;
  readonly sessionId: string | null;
}

async function tryResolve<T>(resolve: () => Promise<T>): Promise<T | null> {
  try {
    return await resolve();
  } catch {
    // Absent outside a request; identity is best-effort and never blocks the row.
    return null;
  }
}

async function resolveAuditContext(): Promise<AuditRequestContext> {
  return {
    ip: await tryResolve(() => resolveClientIp()),
    sessionId: await tryResolve(async () => (await import('@/lib/auth')).getSessionId()),
  };
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
    const context = await resolveAuditContext();

    // WHY the hash is taken over the row payload and not over `entry`: the caller's object omits
    // whatever the writer resolves from the request (ip, session id, actor), so a hash of it could
    // not be re-derived from the database — and a chain nobody can recompute verifies nothing.
    // `canonicaliseAuditRow` is the same function the verifier uses.
    const payload: AuditRowPayload = {
      actor_id: actorId ?? null,
      after_values: entry.afterValues ?? null,
      before_values: entry.beforeValues ?? null,
      entity: entry.entity,
      entity_id: entry.entityId ?? null,
      ip: entry.ip ?? context.ip,
      reason: entry.reason ?? null,
      result: entry.result,
      session_id: entry.sessionId ?? context.sessionId,
      verb: entry.verb,
    };
    const entryHash = computeEntryHash(previousHash, canonicaliseAuditRow(payload));

    const created = await prisma.audit_log.create({
      data: {
        actor_id: payload.actor_id,
        verb: payload.verb,
        entity: payload.entity,
        entity_id: payload.entity_id,
        before_values: jsonInput(entry.beforeValues),
        after_values: jsonInput(entry.afterValues),
        reason: payload.reason,
        ip: payload.ip,
        session_id: payload.session_id,
        result: payload.result,
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
