import { cookies } from 'next/headers';

import { readSessionClaimsFromCookies } from '@/lib/session-token';
import {
  actorStorage,
  currentDbActor,
  MissingDbActorError,
  type DbActor,
} from '@/lib/db-actor';

/**
 * The request-scoped half of the actor resolution: reading the session cookie.
 *
 * WHY this is a separate module from `db-actor.ts`: that module is imported by the Prisma client,
 * which is imported by processes that are not Next requests at all — the backup scheduler, the CLI,
 * the waiver export, and the image's own `tsx -e 'require("@/lib/prisma")'` smoke check. `next/headers`
 * exists only inside a request, so a static import of it from the client's module graph made those
 * processes fail to load. Keeping the cookie read here means requiring Prisma costs nothing outside a
 * request, and the identity rules themselves stay in one place.
 *
 * Nothing here supplies a default: `requireDbActor()` throws rather than inventing an identity, so a
 * query with no scope and no cookie still fails closed.
 */

/** The actor the current request's session cookie names, or null when there is no usable cookie. */
export async function resolveRequestActor(): Promise<DbActor | null> {
  const claims = await readSessionClaimsFromCookies();
  if (claims === null) return null;
  const id = Number.parseInt(claims.userId, 10);
  if (!Number.isInteger(id) || id <= 0) return null;
  return { kind: 'admin', id };
}

/**
 * Resolve the actor for a database call: the scope's, else the request's, else throw.
 *
 * The resolved request actor is written into the scope so a page that issues twenty queries
 * verifies one cookie rather than twenty — but only the identity, never a cached decision about
 * database state.
 */
export async function requireDbActor(): Promise<DbActor> {
  const scoped = currentDbActor();
  if (scoped !== undefined) return scoped;

  const fromRequest = await resolveRequestActor();
  if (fromRequest !== null) {
    actorStorage.enterWith({ actor: fromRequest });
    return fromRequest;
  }

  throw new MissingDbActorError('no withActor() scope and no session cookie on this request');
}

/** True when `cookies()` is usable — i.e. we are inside a request. Used only for diagnostics. */
export async function inRequestScope(): Promise<boolean> {
  try {
    await cookies();
    return true;
  } catch {
    return false;
  }
}
