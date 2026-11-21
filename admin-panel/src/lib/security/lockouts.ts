import { recordAudit } from '@/lib/audit';
import { logToDiscord } from '@/lib/discord-notifier';
import { buildAccountBucketKey, buildIpBucketKey, clearBucket } from '@/lib/auth-rate-limit';
import { endActiveBlocks, recordBlock, type SecurityBlock } from '@/lib/security/block-ledger';

export interface LockoutRecord {
  readonly username: string;
  readonly ip: string;
  readonly expiresAt: Date;
}

export function lockoutBucketKeys(username: string, ip: string): readonly string[] {
  const accountKey = buildAccountBucketKey(username, ip);
  return accountKey === ip ? [accountKey] : [accountKey, buildIpBucketKey(ip)];
}

/**
 * Records the lockout the in-memory counter just produced. Counting stays in memory, so
 * this is one row per lockout, never per attempt — and a failure here must not change the
 * login response the caller already decided on.
 */
export async function recordLoginLockout(record: LockoutRecord): Promise<SecurityBlock | null> {
  try {
    return await recordBlock({
      kind: 'login_lockout',
      source: 'app',
      ip: record.ip,
      subject: record.username,
      detail: { expiresAt: record.expiresAt.toISOString() },
      expiresAt: record.expiresAt,
    });
  } catch (error: unknown) {
    console.error('Security ledger: could not record a login lockout', {
      username: record.username,
      ip: record.ip,
      error: (error as Error).message,
    });
    return null;
  }
}

/** Lifts a lockout: the counter is cleared first, then the ledger row is closed. */
export async function releaseLoginLockout(username: string, ip: string, adminId: number, reason: string): Promise<number> {
  clearBucket(lockoutBucketKeys(username, ip));
  const closed = await endActiveBlocks({ kind: 'login_lockout', ip, subject: username }, adminId);
  await recordAudit({
    verb: 'lockout:unlock',
    entity: 'security',
    entityId: username,
    beforeValues: { ip, active: closed },
    afterValues: { ip, active: 0 },
    reason,
    result: 'success',
  });
  await logToDiscord('Login lockout lifted', `Lockout for **${username}** from ${ip} was lifted`, 3066993, true);
  return closed;
}
