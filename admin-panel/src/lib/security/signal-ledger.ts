import { recordAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import type { NotifyPlan, PageRecord, SecurityDigest } from '@/lib/security/signal';

/**
 * Where "we already told someone" lives.
 *
 * WHY the audit log and not a new table or a Redis key:
 *
 *   · **Durable by construction.** The channel must not re-send an unchanged fact after a restart,
 *     so the record has to outlive the process. The panel already owns one durable, append-only
 *     store of what was done and when — `audit_log` — and "a page was sent to a human" is an
 *     action. A dedicated table would be a second truth about the same thing, and a migration with
 *     its own policy; a Redis key would be lost by the eviction policy (`allkeys-lru`) and silent
 *     across a `down -v`. Append-only is enforced by the absence of UPDATE/DELETE policies, so a
 *     record cannot be rewritten by the next run either.
 *   · **One row per message, never per fact.** The row's `after_values` carries the fact keys the
 *     message named, so the next tick diffs against exactly what a human was told. This is what
 *     makes a repeat impossible rather than merely unlikely, and a write happens only after
 *     delivery succeeded — a failed POST leaves no record, so the fact is retried.
 *   · **Auditable.** The question "did anyone get told, and when?" is answered by the audit page the
 *     operator already has, with no extra surface.
 *
 * WHY the newest row alone is enough: the message always carries the *full* current trigger set, so
 * the last message is a complete statement of what has been said. Older rows are history; retention
 * pruning them (D3) cannot weaken the diff, because only the newest is read.
 */

export const SIGNAL_ENTITY = 'security.signal';
export const SIGNAL_NOTIFIED_VERB = 'security.signal.notified';

interface NotifiedPayload {
  readonly keys?: unknown;
  readonly tone?: unknown;
}

function parseKeys(payload: unknown): readonly string[] | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const keys = (payload as NotifiedPayload).keys;
  if (!Array.isArray(keys)) return null;
  return keys.filter((key): key is string => typeof key === 'string');
}

/**
 * The last message this channel sent, or null when it never has.
 *
 * WHY an unreadable payload reads as null: a row whose keys cannot be parsed is not evidence that
 * anything was said, and treating it as "already notified" would silence a real fact. Re-sending is
 * the safe direction.
 */
export async function readLastPage(): Promise<PageRecord | null> {
  const row = await prisma.audit_log.findFirst({
    where: { entity: SIGNAL_ENTITY, verb: SIGNAL_NOTIFIED_VERB },
    orderBy: { id: 'desc' },
    select: { timestamp: true, after_values: true },
  });
  if (row === null) return null;
  const keys = parseKeys(row.after_values);
  if (keys === null) return null;
  return { notifiedAt: row.timestamp.toISOString(), keys };
}

/**
 * Records one delivered message.
 *
 * WHY `actorId: null` and not a person: the writer is a service with no session (`main.ts` opens a
 * `system:scheduler` scope). Filing the row under an admin would be a lie in the one table whose
 * job is to say who acted, and the RLS policy accepts an anonymous attribution only from a system
 * identity — which is exactly what this is.
 */
export async function recordPage(digest: SecurityDigest, plan: NotifyPlan, now: Date): Promise<void> {
  await recordAudit({
    verb: SIGNAL_NOTIFIED_VERB,
    entity: SIGNAL_ENTITY,
    beforeValues: null,
    afterValues: {
      notifiedAt: now.toISOString(),
      // WHY the overflow key travels with the named ones: the count is how the message reports the
      // facts it could not name, so the next tick has to diff against it too — otherwise a fresh
      // CRITICAL beyond the named ones would change the count and still be judged "unchanged".
      keys:
        plan.overflowKey === null
          ? plan.facts.map((fact) => fact.key)
          : [...plan.facts.map((fact) => fact.key), plan.overflowKey],
      fresh: plan.fresh.map((fact) => fact.key),
      tone: digest.tone,
      counts: digest.counts,
    },
    reason: `${String(plan.facts.length)} push-worthy item(s), ${String(plan.fresh.length)} new`,
    result: 'success',
    actorId: null,
  });
}
