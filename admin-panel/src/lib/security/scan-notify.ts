import { recordAudit } from '@/lib/audit';
import { logToDiscord } from '@/lib/discord-notifier';
import { prisma } from '@/lib/prisma';
import { readCompletedScanFacts, type ScanScope } from '@/lib/security/patching-read';
import { buildScanAnnouncement, scanRunKey, type ScanRunFacts } from '@/lib/security/scan-report';

/**
 * The one message a completed scan sends, and the ledger that keeps it to one.
 *
 * WHY this is called from the ingest route and not from the polling signal: the push IS the scan.
 * The moment a producer says `complete: true`, everything the run saw is stored and resolved, so the
 * numbers cannot change under the message. Waiting for the next signal tick would report a state the
 * next run may already have replaced — and would say nothing at all for a scan that found nothing.
 *
 * WHY the ledger is `audit_log`, keyed by the run: it is the same durable, append-only store the
 * digest channel dedupes against (`signal-ledger.ts`), it survives a restart, and "this run was
 * announced" is an action. The key is the run's `run_started_at`, so a producer's retry of the same
 * run — the shape every scanner already has — adds no second message.
 *
 * WHY a failure cannot fail the push: the findings are stored before this runs, and a webhook is a
 * convenience. The failure is written as its own audit row, behind a different verb so it does not
 * consume the run's dedupe slot: a swallowed message stays retryable and stays visible on the page.
 */

export const SCAN_ENTITY = 'security.scan';
export const SCAN_NOTIFIED_VERB = 'security.scan.notified';
export const SCAN_NOTIFY_FAILED_VERB = 'security.scan.notify-failed';

export type ScanAnnounceStatus = 'sent' | 'already-sent' | 'failed';

/** Whether this run's message already left, from the durable ledger (never from memory). */
async function alreadySent(key: string): Promise<boolean> {
  const row = await prisma.audit_log.findFirst({
    where: { entity: SCAN_ENTITY, verb: SCAN_NOTIFIED_VERB, entity_id: key },
    select: { id: true },
  });
  return row !== null;
}

async function recordSent(scan: ScanScope, facts: ScanRunFacts, actorId: number | null): Promise<void> {
  await recordAudit({
    verb: SCAN_NOTIFIED_VERB,
    entity: SCAN_ENTITY,
    entityId: scanRunKey(scan.source, scan.host, scan.runStartedAt),
    afterValues: {
      source: scan.source,
      host: scan.host,
      runStartedAt: scan.runStartedAt.toISOString(),
      total: facts.total,
      added: facts.added,
      criticals: facts.criticals,
      waived: facts.waived,
    },
    reason: `${String(facts.total)} findings, ${String(facts.added)} new`,
    result: 'success',
    actorId,
  });
}

/**
 * The visible trace of a message nobody received.
 *
 * WHY it catches its own failure: this runs after the push has already been stored, and an audit
 * write that throws here would turn a delivered finding into a 500. The console line is the last
 * resort when even the trail is unavailable.
 */
async function recordFailure(scan: ScanScope, reason: string, actorId: number | null): Promise<void> {
  try {
    await recordAudit({
      verb: SCAN_NOTIFY_FAILED_VERB,
      entity: SCAN_ENTITY,
      entityId: scanRunKey(scan.source, scan.host, scan.runStartedAt),
      afterValues: {
        source: scan.source,
        host: scan.host,
        runStartedAt: scan.runStartedAt.toISOString(),
      },
      reason,
      result: 'failure',
      actorId,
    });
  } catch (error) {
    console.error('security scan announcement could not be recorded:', error);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function deliver(
  scan: ScanScope,
  actorId: number | null,
  now: Date,
): Promise<ScanAnnounceStatus> {
  if (await alreadySent(scanRunKey(scan.source, scan.host, scan.runStartedAt))) return 'already-sent';
  const facts = await readCompletedScanFacts(scan, now);
  const announcement = buildScanAnnouncement(facts);
  const delivered = await logToDiscord(
    announcement.title,
    announcement.body,
    announcement.color,
    announcement.mention,
  );
  if (!delivered) {
    await recordFailure(scan, 'the notifier did not accept the message', actorId);
    return 'failed';
  }
  await recordSent(scan, facts, actorId);
  return 'sent';
}

/**
 * Announces one completed scan. Never throws: the caller has already answered its producer.
 *
 * WHY `already-sent` is not an error: a re-push is the normal shape of a producer retry, and the only
 * alternative would be a second message nobody asked for.
 */
export async function announceCompletedScan(
  scan: ScanScope,
  actorId: number | null = null,
  now: Date = new Date(),
): Promise<ScanAnnounceStatus> {
  try {
    return await deliver(scan, actorId, now);
  } catch (error) {
    await recordFailure(scan, describe(error), actorId);
    return 'failed';
  }
}
