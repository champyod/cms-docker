import { resolveRequestActor } from '@/lib/db-actor-request';

/**
 * The administrator behind the current request, for a write that records an author.
 *
 * WHY this is read here and not passed in: an author column filled from a caller's argument
 * lets any caller attribute its own write to another administrator. The session is the only
 * party that knows who is acting, so the id comes from it and never from a parameter. A
 * system actor is refused too — an announcement has a human author or it has none.
 */
export async function resolveActingAdminId(): Promise<number | null> {
  const actor = await resolveRequestActor();
  if (actor === null || actor.kind !== 'admin') return null;
  return actor.id;
}

/** The refusal every authoring action returns when no administrator is signed in. */
export const NOT_AUTHENTICATED = 'Not authenticated';
