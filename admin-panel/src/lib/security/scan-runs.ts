import { prisma } from '@/lib/prisma';
import { scanRunKey, type ScanRun } from '@/lib/security/scan-report';

// Which runs are finished, read from the ingest's own audit rows.
// WHY the audit log: each accepted push writes one row there already, it is durable and append-only,
// so the poller needs no new table, no migration and no second ledger of "a scan spoke".

/** The row the ingest writes per accepted push; `after_values` names the run it belongs to. */
export const SCAN_PUSH_ENTITY = 'security_findings';
export const SCAN_PUSH_VERB = 'security.findings.ingest';

/** How long a run must be silent before it is finished: batches of one run arrive seconds apart. */
export const SCAN_QUIET_WINDOW_MS = 120_000;

/** How many pushes the poller looks back over: enough for several runs at ~55 batches each. */
export const SCAN_PUSH_LOOKBACK = 400;

/** One push as the ledger recorded it: which box, which run. */
interface PushIdentity {
  readonly host: string | null;
  readonly runStartedAt: Date;
}

/** A push whose row predates the run fields, or whose payload was truncated, names no run. */
function parsePush(payload: unknown): PushIdentity | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as { host?: unknown; run_started_at?: unknown };
  if (record.run_started_at === undefined || record.run_started_at === null) return null;
  if (typeof record.run_started_at !== 'string') return null;
  const runStartedAt = new Date(record.run_started_at);
  if (Number.isNaN(runStartedAt.getTime())) return null;
  const host = typeof record.host === 'string' && record.host.length > 0 ? record.host : null;
  return { host, runStartedAt };
}

/** The newest run per box, keyed by what identifies it: the box and its start. */
function newestPerHost(pushes: readonly (PushIdentity & { readonly lastPushAt: Date })[]): ScanRun[] {
  const newest = new Map<string, ScanRun>();
  for (const push of pushes) {
    const key = push.host ?? '-';
    const seen = newest.get(key);
    // WHY the newest run replaces the older one: an older run's message would describe a list the
    // newer run has already replaced, and a late batch of it must not speak over the newest scan.
    if (seen === undefined || push.runStartedAt > seen.runStartedAt) {
      newest.set(key, { host: push.host, runStartedAt: push.runStartedAt, lastPushAt: push.lastPushAt });
    }
  }
  return [...newest.values()].sort((left, right) => left.runStartedAt.getTime() - right.runStartedAt.getTime());
}

/** The finished runs as of `now`: newest per box, and silent for the quiet window. */
// WHY newest per box: a run is superseded the moment a newer one starts, so an older one never speaks.
export async function readFinishedScanRuns(now: Date): Promise<ScanRun[]> {
  const rows = await prisma.audit_log.findMany({
    where: { entity: SCAN_PUSH_ENTITY, verb: SCAN_PUSH_VERB },
    orderBy: { id: 'desc' },
    take: SCAN_PUSH_LOOKBACK,
    select: { timestamp: true, after_values: true },
  });

  const runs = new Map<string, { host: string | null; runStartedAt: Date; lastPushAt: Date }>();
  for (const row of rows) {
    const push = parsePush(row.after_values);
    if (push === null) continue;
    const key = scanRunKey(push.host, push.runStartedAt);
    const seen = runs.get(key);
    if (seen === undefined) {
      runs.set(key, { host: push.host, runStartedAt: push.runStartedAt, lastPushAt: row.timestamp });
    } else if (row.timestamp > seen.lastPushAt) {
      seen.lastPushAt = row.timestamp;
    }
  }

  const cutoff = now.getTime() - SCAN_QUIET_WINDOW_MS;
  return newestPerHost([...runs.values()]).filter((run) => run.lastPushAt.getTime() <= cutoff);
}
