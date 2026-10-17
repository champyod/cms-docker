import { prisma } from '@/lib/prisma';
import { ROOT_ACTOR_USERNAME } from '@/lib/permission-groups';

/**
 * The actor a script-side write is attributed to.
 *
 * WHY the name and not NULL: `audit_log.actor_id` is nullable, so a caller with no session could
 * file a write under nobody at all — and a trail that reads as NULL is exactly what the operator
 * asked to end. The seeded `root` admin is the account that owns every script-side action, so its
 * id is resolved here, at the one place both a CLI verb and any future script-side caller read it.
 *
 * WHY a missing row is fatal: falling back to NULL would file the write under nobody, and falling
 * back to another admin would attribute it to someone who did not do it. Neither is a trail, so
 * the write stops until the actor exists.
 */
export async function resolveRootActorId(): Promise<number> {
  const root = await prisma.admins.findUnique({
    where: { username: ROOT_ACTOR_USERNAME },
    select: { id: true },
  });
  if (root === null) {
    throw new Error(
      `no admin named ${ROOT_ACTOR_USERNAME} to attribute this write to; the audit trail never files a write as NULL`,
    );
  }
  return root.id;
}
