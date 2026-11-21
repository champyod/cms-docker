import { getSession } from '@/lib/auth';

/**
 * The admin a panel write is attributed to.
 *
 * WHY it throws instead of answering undefined: every action gates on a permission first, and a
 * permission needs a session — so reaching a write with no actor means the session vanished
 * between the check and the write, or a caller skipped the gate. An audit row filed as NULL would
 * then be a lie about who did it, and the trail is the one place that must not lie.
 */
export async function requirePanelActorId(): Promise<number> {
  const session = await getSession();
  const actorId = session === null ? Number.NaN : Number.parseInt(session.userId, 10);
  if (!Number.isInteger(actorId)) {
    throw new Error('no signed-in admin to attribute this write to');
  }
  return actorId;
}
