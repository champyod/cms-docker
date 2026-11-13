import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';
import { NextResponse } from 'next/server';

import { MissingDbActorError } from '@/lib/db-actor';
import { DEFAULT_LOCALE, localeFromPath } from '@/lib/locales';
import { REQUEST_PATH_HEADER } from '@/lib/request-path';

/**
 * What an actorless query looks like to the caller, decided once for every surface.
 *
 * WHY a translator instead of a try/catch per call site: `MissingDbActorError` is thrown from the
 * one client every query goes through (src/lib/prisma.ts), which means it is raised in a page
 * render, a server action and a route handler alike. Left alone it reaches Next as an unhandled
 * error and the caller gets the framework's error page with a digest — the surface the operator
 * saw. The three callers want three different answers, and the request itself is what says which
 * one this is, so the decision belongs here rather than repeated 300 times.
 *
 * WHY NOT weaken the throw: every table is row-level secured on `cms.actor`; a query without an
 * identity is a bug, and this module only chooses how its failure is presented. It never supplies
 * an actor and it never swallows an error it does not recognise.
 */

/** Next's own header on a server-action POST: present means an action, not a page render. */
export const ACTION_HEADER = 'next-action';

/** Matched by name as well as class: the server compiles actions and routes separately, and a
 *  class loaded twice is two classes — the name is what survives that. */
const ACTOR_ERROR_NAME = 'MissingDbActorError';

const API_ROOT = '/api';
const LOGIN_PATH = '/auth/login';
const ACTORLESS_API_STATUS = 401;
/** Deliberately generic: the client is told it is unauthenticated and nothing about why. */
const ACTORLESS_API_BODY = { error: 'Unauthorized' } as const;

export type ActorSurface = 'page' | 'action' | 'api';

export interface ActorRequest {
  readonly path: string;
  readonly isAction: boolean;
}

/** Whether a request is a page render, a server action or an /api route handler. */
export function actorSurfaceOf(request: ActorRequest): ActorSurface {
  if (request.path === API_ROOT || request.path.startsWith(`${API_ROOT}/`)) return 'api';
  return request.isAction ? 'action' : 'page';
}

/** Whether this error is the deliberate "a query ran with no identity" failure. */
export function isMissingDbActor(error: unknown): error is MissingDbActorError {
  if (error instanceof MissingDbActorError) return true;
  return error instanceof Error && error.name === ACTOR_ERROR_NAME;
}

/**
 * The login for the locale the given path is served under.
 *
 * WHY no base path here: a redirect thrown while rendering or acting is prefixed by Next itself
 * (pinned in tests/base-path.test.ts); prefixing it here would land the prefix twice. A route
 * handler emits its own Location verbatim, which is why it never uses this target.
 */
export function loginTargetFor(path: string): string {
  return `/${localeFromPath(path) ?? DEFAULT_LOCALE}${LOGIN_PATH}`;
}

/** The 401 an /api caller gets, or undefined when the error is not the actorless one. */
export function actorlessApiResponse(error: unknown): NextResponse | undefined {
  if (!isMissingDbActor(error)) return undefined;
  return NextResponse.json(ACTORLESS_API_BODY, { status: ACTORLESS_API_STATUS });
}

/**
 * Present an actorless failure on the surface the request names. Never returns.
 *
 * A page render and a server action both get the login redirect: Next turns the thrown redirect
 * into a Location for either (307 for a render, 303 for an action, which the client router
 * follows). An /api caller must not be redirected — it gets the untouched error so the route's own
 * `apiError` funnel can answer 401 — and anything that is not the actorless error is rethrown as
 * it arrived, so this never becomes a catch-all over real faults.
 */
export async function surfaceActorlessFailure(
  error: unknown,
  request?: ActorRequest,
): Promise<never> {
  // WHY first: a redirect or notFound already in flight is control flow, not a fault. Classifying
  // it as a fault would turn a legitimate redirect into a 401 or an error page.
  unstable_rethrow(error);
  if (!isMissingDbActor(error)) throw error;

  const surface = request ?? (await readActorRequest());
  // No request to judge (the backup scheduler, the CLI, the image smoke check): fail as before.
  if (surface === undefined) throw error;
  // The route handler answers 401 through apiError; redirecting here would hand an API caller HTML.
  if (actorSurfaceOf(surface) === 'api') throw error;

  redirect(loginTargetFor(surface.path));
}

/** The path and action marker of the current request, or undefined outside one. */
async function readActorRequest(): Promise<ActorRequest | undefined> {
  let requestHeaders: Headers;
  try {
    requestHeaders = await headers();
  } catch {
    return undefined;
  }
  const stamped = requestHeaders.get(REQUEST_PATH_HEADER);
  const referer = requestHeaders.get('referer');
  return {
    path: pathOf(stamped ?? referer ?? '/'),
    isAction: requestHeaders.get(ACTION_HEADER) !== null,
  };
}

/** A stamped path is already one; a referer is a URL. Both reduce to a pathname. */
function pathOf(value: string): string {
  try {
    return new URL(value, 'http://panel.invalid').pathname;
  } catch {
    return value;
  }
}
