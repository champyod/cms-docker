import { recordAudit } from '@/lib/audit';
import { logToDiscord } from '@/lib/discord-notifier';
import { prisma } from '@/lib/prisma';
import { readScanRunFacts } from '@/lib/security/patching-read-scan';
import { readFinishedScanRuns } from '@/lib/security/scan-runs';
import { buildScanAnnouncement, scanRunKey, type ScanRun, type ScanRunFacts } from '@/lib/security/scan-report';

// The one message a finished scan sends, and the ledger that keeps it to one.
// WHY the poller and not the ingest: the ingest must not wait on a webhook, and only a poller can see
// a run finish — the last batch of a large scan arrives minutes after the first.

export const SCAN_ENTITY = 'security.scan';
export const SCAN_NOTIFIED_VERB = 'security.scan.notified';
export const SCAN_NOTIFY_FAILED_VERB = 'security.scan.notify-failed';

export type ScanAnnounceStatus = 'sent' | 'already-sent' | 'failed';

/** What one run's turn produced, keyed by the run, for the tick's log line. */
export interface ScanAnnounceResult {
  readonly key: string;
  readonly status: ScanAnnounceStatus;
}

/** Whether this run's message already left, from the durable ledger (never from memory). */
async function alreadySent(key: string): Promise<boolean> {
  const row = await prisma.audit_log.findFirst({
    where: { entity: SCAN_ENTITY, verb: SCAN_NOTIFIED_VERB, entity_id: key },
    select: { id: true },
  });
  return row !== null;
}

/** The run's slot, written only after the receiver accepted the message. */
async function recordSent(run: ScanRun, facts: ScanRunFacts): Promise<void> {
  await recordAudit({
    verb: SCAN_NOTIFIED_VERB,
    entity: SCAN_ENTITY,
    entityId: scanRunKey(run.host, run.runStartedAt),
    afterValues: {
      host: run.host,
      runStartedAt: run.runStartedAt.toISOString(),
      lastPushAt: run.lastPushAt.toISOString(),
      standing: facts.standing,
      added: facts.added,
      criticals: facts.criticals,
      waived: facts.waived,
    },
    reason: `${String(facts.standing)} standing, ${String(facts.added)} new, ${String(facts.criticals)} unwaived CRITICAL`,
    result: 'success',
    actorId: null,
  });
}

/** The visible trace of a message nobody received; it catches its own failure so the tick never throws. */
async function recordFailure(run: ScanRun, reason: string): Promise<void> {
  try {
    await recordAudit({
      verb: SCAN_NOTIFY_FAILED_VERB,
      entity: SCAN_ENTITY,
      entityId: scanRunKey(run.host, run.runStartedAt),
      afterValues: { host: run.host, runStartedAt: run.runStartedAt.toISOString() },
      reason,
      result: 'failure',
      actorId: null,
    });
  } catch (error) {
    console.error('security scan announcement could not be recorded:', error);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Announces one finished run; never throws, and `already-sent` is the normal answer between runs. */
async function announceRun(run: ScanRun, now: Date): Promise<ScanAnnounceStatus> {
  const key = scanRunKey(run.host, run.runStartedAt);
  try {
    if (await alreadySent(key)) return 'already-sent';
    const facts = await readScanRunFacts(run, now);
    const announcement = buildScanAnnouncement(facts);
    const delivered = await logToDiscord(
      announcement.title,
      announcement.body,
      announcement.color,
      announcement.mention,
      announcement.footer,
    );
    if (!delivered) {
      await recordFailure(run, 'the notifier did not accept the message');
      return 'failed';
    }
    await recordSent(run, facts);
    return 'sent';
  } catch (error) {
    await recordFailure(run, describe(error));
    return 'failed';
  }
}

/** One tick of the scan channel: every finished run that has not spoken yet says its piece. */
export async function announceFinishedScans(now: Date = new Date()): Promise<readonly ScanAnnounceResult[]> {
  const runs = await readFinishedScanRuns(now);
  const results: ScanAnnounceResult[] = [];
  for (const run of runs) {
    const status = await announceRun(run, now);
    results.push({ key: scanRunKey(run.host, run.runStartedAt), status });
  }
  return results;
}
