import { recordAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { isPatchingSource } from '@/lib/security/patching';
import { MAX_FINDING_KEY_LENGTH } from '@/lib/security/patching-ingest';

/**
 * The waiver write path, callable in-process.
 *
 * WHY a panel-actions module and not the server action itself: waivers are a write the CLI
 * may need to reach with the `root` actor while no panel server is up, and it has to be the
 * same write either way — the action adds the permission check, the session actor and the
 * screen refresh, exactly like the other panel-actions modules.
 *
 * WHY `review_by` is mandatory and must be in the future: the contract makes a waiver a
 * decision *with a date*. A waiver without one is how `.trivyignore` lines become permanent,
 * and a date already in the past would create an expired waiver in the same breath as it is
 * created — an approval that was never true.
 */

export interface WaiverInput {
  readonly source: string;
  /** The finding key, or a CVE id the finding carries. */
  readonly match: string;
  readonly reason: string;
  /** ISO date or date-only string; must be after now. */
  readonly reviewBy: string;
}

export interface WaiverWriteResult {
  readonly success: boolean;
  readonly error?: string;
  readonly id?: number;
}

const MATCH_LIMIT = MAX_FINDING_KEY_LENGTH;

function reviewDate(raw: string, now: Date): Date | null {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.getTime() <= now.getTime()) return null;
  return parsed;
}

export async function createWaiver(
  actorId: number,
  input: WaiverInput,
  now: Date = new Date(),
): Promise<WaiverWriteResult> {
  const source = input.source.trim();
  if (!isPatchingSource(source)) {
    return { success: false, error: 'source must be one of diun, rootfs, osv' };
  }
  const match = input.match.trim();
  if (match === '') return { success: false, error: 'match is required' };
  if (match.length > MATCH_LIMIT) {
    return { success: false, error: `match exceeds ${MATCH_LIMIT} characters` };
  }
  const reason = input.reason.trim();
  if (reason === '') return { success: false, error: 'A reason is required to waive a finding' };
  const reviewBy = reviewDate(input.reviewBy, now);
  if (reviewBy === null) {
    return { success: false, error: 'review_by must be a future date' };
  }

  const row = await prisma.security_waivers.create({
    data: { source, match, reason, review_by: reviewBy, created_by: actorId },
    select: { id: true },
  });
  await recordAudit({
    actorId,
    verb: 'security.waiver.create',
    entity: 'security_waiver',
    entityId: String(row.id),
    afterValues: { source, match, review_by: reviewBy.toISOString() },
    reason,
    result: 'success',
  });
  return { success: true, id: row.id };
}

export async function endWaiver(
  actorId: number,
  waiverId: number,
  reason: string,
  now: Date = new Date(),
): Promise<WaiverWriteResult> {
  if (!Number.isInteger(waiverId) || waiverId <= 0) {
    return { success: false, error: 'not a waiver id' };
  }
  const trimmed = reason.trim();
  if (trimmed === '') return { success: false, error: 'A reason is required to end a waiver' };

  const updated = await prisma.security_waivers.updateMany({
    where: { id: waiverId, ended_at: null },
    data: { ended_at: now },
  });
  if (updated.count === 0) {
    return { success: false, error: 'waiver not found or already ended' };
  }
  await recordAudit({
    actorId,
    verb: 'security.waiver.end',
    entity: 'security_waiver',
    entityId: String(waiverId),
    beforeValues: { ended_at: null },
    afterValues: { ended_at: now.toISOString() },
    reason: trimmed,
    result: 'success',
  });
  return { success: true, id: waiverId };
}
