import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MissingDbActorError } from '@/lib/db-actor';

/**
 * The surface an actorless failure is presented on, pinned one behaviour per test.
 *
 * WHY these run against the throw itself rather than a rendered page: the failure happens inside a
 * Prisma call, so what matters is what leaves that call — a redirect control-flow error for a page
 * or an action, the untouched error for an /api caller, and never a rewrite of anything else.
 */

const BETA_BASE_PATH = '/beta';

/** The redirect Next itself throws, read the way the framework reads it. */
async function isRedirect(error: unknown): Promise<boolean> {
  const { isRedirectError } = await import('next/dist/client/components/redirect-error');
  return isRedirectError(error);
}

async function redirectTarget(error: unknown): Promise<string> {
  const { getURLFromRedirectError } = await import('next/dist/client/components/redirect');
  return getURLFromRedirectError(error as never);
}

/** Runs `fn` and returns whatever it threw, so a control-flow error can be inspected. */
async function thrownBy(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

function actorless(): MissingDbActorError {
  return new MissingDbActorError('no withActor() scope and no session cookie on this request');
}

const PAGE_FACTS = { path: '/th/people/users', isAction: false } as const;
const ACTION_FACTS = { path: '/en/people/users', isAction: true } as const;
const API_FACTS = { path: '/api/teams', isAction: false } as const;

describe('actorSurfaceOf', () => {
  it('names a page render, an action and an api route apart', async () => {
    const { actorSurfaceOf } = await import('@/lib/actor-error-surface');

    expect(actorSurfaceOf(PAGE_FACTS)).toBe('page');
    expect(actorSurfaceOf(ACTION_FACTS)).toBe('action');
    expect(actorSurfaceOf(API_FACTS)).toBe('api');
  });

  it('keeps an api route an api route even if it carries the action header', async () => {
    const { actorSurfaceOf } = await import('@/lib/actor-error-surface');

    expect(actorSurfaceOf({ path: '/api/teams', isAction: true })).toBe('api');
  });
});

describe('loginTargetFor', () => {
  it('takes the locale from the path it was given', async () => {
    const { loginTargetFor } = await import('@/lib/actor-error-surface');

    expect(loginTargetFor('/th/people/users')).toBe('/th/auth/login');
    expect(loginTargetFor('/en')).toBe('/en/auth/login');
  });

  it('falls back to the default locale for a path with no locale at all', async () => {
    const { loginTargetFor } = await import('@/lib/actor-error-surface');

    expect(loginTargetFor('/people/users')).toBe('/en/auth/login');
    expect(loginTargetFor('/xx/people/users')).toBe('/en/auth/login');
  });
});

describe('surfaceActorlessFailure — page render', () => {
  it('throws the login redirect for the locale of the path', async () => {
    const { surfaceActorlessFailure } = await import('@/lib/actor-error-surface');

    const thrown = await thrownBy(() => surfaceActorlessFailure(actorless(), PAGE_FACTS));

    expect(await isRedirect(thrown)).toBe(true);
    expect(await redirectTarget(thrown)).toBe('/th/auth/login');
  });

  it('leaves the base path to the framework, which prefixes a rendered redirect', async () => {
    const { surfaceActorlessFailure } = await import('@/lib/actor-error-surface');
    const { addPathPrefix } = await import('next/dist/shared/lib/router/utils/add-path-prefix');

    const thrown = await thrownBy(() => surfaceActorlessFailure(actorless(), PAGE_FACTS));
    const target = await redirectTarget(thrown);

    // Why: a redirect thrown while rendering gets `basePath` added by Next (pinned in
    // base-path.test.ts). Prefixing here would land the prefix twice.
    expect(target.startsWith(BETA_BASE_PATH)).toBe(false);
    expect(addPathPrefix(target, BETA_BASE_PATH)).toBe('/beta/th/auth/login');
  });
});

describe('surfaceActorlessFailure — server action', () => {
  it('throws the login redirect, which the action runtime turns into a 303', async () => {
    const { surfaceActorlessFailure } = await import('@/lib/actor-error-surface');

    const thrown = await thrownBy(() => surfaceActorlessFailure(actorless(), ACTION_FACTS));

    expect(await isRedirect(thrown)).toBe(true);
    expect(await redirectTarget(thrown)).toBe('/en/auth/login');
  });
});

describe('surfaceActorlessFailure — route handler', () => {
  it('rethrows untouched, so the /api caller can answer 401 instead of a redirect', async () => {
    const { surfaceActorlessFailure } = await import('@/lib/actor-error-surface');
    const error = actorless();

    await expect(surfaceActorlessFailure(error, API_FACTS)).rejects.toBe(error);
  });
});

describe('actorlessApiResponse', () => {
  it('answers 401 with a small JSON body', async () => {
    const { actorlessApiResponse } = await import('@/lib/actor-error-surface');

    const response = actorlessApiResponse(actorless());

    expect(response?.status).toBe(401);
    expect(response?.headers.get('content-type')).toContain('application/json');
    expect(await response?.json()).toEqual({ error: 'Unauthorized' });
  });

  it('leaks neither the digest nor the actor wording', async () => {
    const { actorlessApiResponse } = await import('@/lib/actor-error-surface');

    const body = JSON.stringify(await actorlessApiResponse(actorless())?.json());

    expect(body).not.toContain('digest');
    expect(body).not.toContain('MissingDbActor');
    expect(body).not.toContain('cms.actor');
    expect(body).not.toContain('withActor');
  });
});

describe('any other error', () => {
  it('passes through the translator unchanged', async () => {
    const { surfaceActorlessFailure } = await import('@/lib/actor-error-surface');
    const fault = new Error('a real fault');

    await expect(surfaceActorlessFailure(fault, PAGE_FACTS)).rejects.toBe(fault);
    await expect(surfaceActorlessFailure(fault, API_FACTS)).rejects.toBe(fault);
  });

  it('is not turned into a 401 by the api response builder', async () => {
    const { actorlessApiResponse } = await import('@/lib/actor-error-surface');

    expect(actorlessApiResponse(new Error('a real fault'))).toBeUndefined();
  });
});

describe('a redirect already in flight', () => {
  it('survives the translator as a redirect, never converted to 401 or a fault', async () => {
    const { surfaceActorlessFailure, actorlessApiResponse } = await import('@/lib/actor-error-surface');
    const { redirect } = await import('next/navigation');

    const inFlight = await thrownBy(async () => redirect('/en/contests'));

    const passed = await thrownBy(() => surfaceActorlessFailure(inFlight, API_FACTS));

    expect(passed).toBe(inFlight);
    expect(await isRedirect(passed)).toBe(true);
    expect(await redirectTarget(passed)).toBe('/en/contests');
    expect(actorlessApiResponse(inFlight)).toBeUndefined();
  });
});

describe('outside a request', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('rethrows the actor error rather than inventing a destination', async () => {
    vi.doMock('next/headers', () => ({
      headers: async (): Promise<Headers> => {
        throw new Error('headers() is only available inside a request');
      },
    }));
    const { surfaceActorlessFailure } = await import('@/lib/actor-error-surface');
    const error = actorless();

    await expect(surfaceActorlessFailure(error)).rejects.toBe(error);
  });
});

describe('the request it reads', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('takes the action header for an action and the stamped path for the locale', async () => {
    vi.doMock('next/headers', () => ({
      headers: async (): Promise<Headers> =>
        new Headers({ 'x-cms-path': '/th/people/users', 'next-action': 'abc123' }),
    }));
    const { surfaceActorlessFailure } = await import('@/lib/actor-error-surface');

    const thrown = await thrownBy(() => surfaceActorlessFailure(actorless()));

    expect(await redirectTarget(thrown)).toBe('/th/auth/login');
  });

  it('answers an api request with the actor error, not a redirect', async () => {
    vi.doMock('next/headers', () => ({
      headers: async (): Promise<Headers> => new Headers({ 'x-cms-path': '/api/teams' }),
    }));
    const { surfaceActorlessFailure } = await import('@/lib/actor-error-surface');
    const { MissingDbActorError: ErrorClass } = await import('@/lib/db-actor');
    const error = new ErrorClass('no scope');

    const thrown = await thrownBy(() => surfaceActorlessFailure(error));

    expect(thrown).toBe(error);
  });
});

describe('the query funnel', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('sends a page query with no session to its localised login', async () => {
    vi.doMock('next/headers', () => ({
      headers: async (): Promise<Headers> => new Headers({ 'x-cms-path': '/th/people/users' }),
    }));
    vi.doMock('@/lib/session-token', () => ({ readSessionClaimsFromCookies: async () => null }));
    const { requireDbActor } = await import('@/lib/db-actor-request');

    const thrown = await thrownBy(() => requireDbActor());

    expect(await isRedirect(thrown)).toBe(true);
    expect(await redirectTarget(thrown)).toBe('/th/auth/login');
  });

  it('hands an api query the actor error so apiError can answer 401', async () => {
    vi.doMock('next/headers', () => ({
      headers: async (): Promise<Headers> => new Headers({ 'x-cms-path': '/api/teams' }),
    }));
    vi.doMock('@/lib/session-token', () => ({ readSessionClaimsFromCookies: async () => null }));
    const { requireDbActor } = await import('@/lib/db-actor-request');

    const thrown = await thrownBy(() => requireDbActor());

    expect((thrown as Error).name).toBe('MissingDbActorError');
  });
});

describe('apiError', () => {
  it('translates the actor error to 401 and leaves other failures at 500', async () => {
    const { apiError } = await import('@/lib/api-utils');

    const actorlessResponse = apiError(actorless());
    const faultResponse = apiError(new Error('a real fault'));

    expect(actorlessResponse.status).toBe(401);
    expect(await actorlessResponse.json()).toEqual({ error: 'Unauthorized' });
    expect(faultResponse.status).toBe(500);
    expect(await faultResponse.json()).toEqual({
      success: false,
      error: 'An unexpected error occurred',
    });
  });
});
