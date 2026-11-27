import { PrismaClient } from '@prisma/client';

import { actorClaim } from '@/lib/db-actor';

/** See {@link buildActorAwareClient}. */
export { buildActorAwareClient };

// Identity is structural: nothing reaches Postgres without a stamped transaction, and a call with no identity throws.

type AnyDelegate = Record<string, unknown>;
type AnyClient = Record<string, unknown>;

/** Internal Prisma properties that must pass through untouched. */
function isInternal(prop: string): boolean {
  return prop.startsWith('$') || prop.startsWith('_');
}

/** A Prisma model delegate is an object with the query verbs on it. */
function isDelegate(value: unknown): value is AnyDelegate {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnyDelegate)['findMany'] === 'function'
  );
}

/** The raw verbs, which reach tables without going through a model delegate. */
const RAW_VERBS = new Set([
  '$queryRaw',
  '$queryRawUnsafe',
  '$executeRaw',
  '$executeRawUnsafe',
]);

// $queryRaw because set_config returns a row; bound to its client because node drops the receiver on an unbound call.
function stamp(client: AnyClient, claim: string): Promise<unknown> {
  const queryRaw = (client['$queryRaw'] as (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<unknown>).bind(client);
  return queryRaw`SELECT set_config('cms.actor', ${claim}, true)`;
}

// Deferred so a call can join $transaction([...]): a started promise cannot move into another transaction.
type Deferred<T> = Promise<T> & { readonly [DEFERRED]: (tx: AnyClient) => Promise<T> };

const DEFERRED = Symbol('cms.deferredQuery');

function isDeferred(value: unknown): value is Deferred<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<symbol, unknown>)[DEFERRED] === 'function'
  );
}

function buildActorAwareClient(base: PrismaClient): PrismaClient {
  // Every call opens a transaction because SET LOCAL needs one, and a shared pool has no per-request scope.
  async function inActorTransaction<T>(
    operation: (tx: AnyClient, claim: string) => Promise<T>,
  ): Promise<T> {
    // Dynamic import: next/headers only exists inside a request, and a static one would break every non-request process.
    const { requireDbActor } = await import('@/lib/db-actor-request');
    const claim = actorClaim(await requireDbActor());
    return base.$transaction(async (tx) => {
      const client = tx as unknown as AnyClient;
      await stamp(client, claim);
      return operation(client, claim);
    });
  }

  /** Wrap a statement so it can be awaited alone or collected into one transaction. */
  function defer<T>(run: (tx: AnyClient) => Promise<T>): Deferred<T> {
    let started: Promise<T> | undefined;
    const start = (): Promise<T> => (started ??= inActorTransaction(run));
    // The three Promise methods a chained call site may use; a bare PromiseLike would break it.
    const deferred = {
      [DEFERRED]: run,
      then: (onFulfilled?: never, onRejected?: never) => start().then(onFulfilled, onRejected),
      catch: (onRejected?: never) => start().catch(onRejected),
      finally: (onFinally?: never) => start().finally(onFinally),
    };
    return deferred as unknown as Deferred<T>;
  }

  function modelProxy(name: string, delegate: AnyDelegate): AnyDelegate {
    return new Proxy(delegate, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== 'function' || typeof prop !== 'string') return value;
        const method = prop;
        return (...args: unknown[]) =>
          defer((tx) => {
            const model = tx[name] as AnyDelegate;
            const fn = model[method] as (...a: unknown[]) => Promise<unknown>;
            return fn.apply(model, args);
          });
      },
    });
  }

  return new Proxy(base, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && RAW_VERBS.has(prop)) {
        // apply(tx, args): Prisma's raw verbs are methods that read `this`, so an unbound call throws.
        return (...args: unknown[]) =>
          defer(async (tx) => {
            const fn = tx[prop] as unknown as (...a: unknown[]) => Promise<unknown>;
            return await fn.apply(tx, args);
          });
      }

      // $transaction stamps the actor once at the top of the caller's transaction, not around each statement.
      if (prop === '$transaction') {
        return (arg: unknown) => {
          if (typeof arg === 'function') {
            return inActorTransaction((tx) =>
              (arg as (client: unknown) => Promise<unknown>)(tx),
            );
          }
          const items = arg as unknown[];
          if (!items.every(isDeferred)) {
            // Refuse a foreign promise: it would run outside the stamped transaction, so the caller would get atomicity it never had.
            return Promise.reject(
              new Error(
                'cms: every element of $transaction([...]) must come from the actor-aware client; ' +
                  'a foreign promise would run outside the stamped transaction',
              ),
            );
          }
          return inActorTransaction(async (tx) => {
            const results: unknown[] = [];
            for (const item of items as Deferred<unknown>[]) {
              results.push(await item[DEFERRED](tx));
            }
            return results;
          });
        };
      }

      if (typeof prop === 'string' && !isInternal(prop)) {
        const value = Reflect.get(target, prop, receiver);
        if (isDelegate(value)) return modelProxy(prop, value);
        return value;
      }

      return Reflect.get(target, prop, receiver);
    },
  });
}

const baseClient = new PrismaClient({
  // Query logging buries deploy output; errors and warnings stay on so a failed seed reports its cause.
  log: ['error', 'warn'],
});

const globalForPrisma = global as unknown as { prisma: PrismaClient };

/** Typed as PrismaClient because it is one: the wrapper adds a transaction and changes no signature. */
export const prisma: PrismaClient =
  process.env.NODE_ENV !== 'production'
    ? (globalForPrisma.prisma ??= buildActorAwareClient(baseClient))
    : buildActorAwareClient(baseClient);

// Entry points that establish an identity need an unwrapped client; hiding it would make them open a second pool.
export const prismaUnscoped: PrismaClient = baseClient;

/** Read once so the variable name and the error message cannot drift. */
const ADMIN_LOGIN_DATABASE_URL_ENV = 'ADMIN_LOGIN_DATABASE_URL';

/** The role that variable connects as; restated in the failure so an operator can search for it. */
const ADMIN_LOGIN_ROLE = 'cms_admin_login';

let adminLoginClient: PrismaClient | undefined;

// Login-only connection to admins.authentication: lazy, and no fallback to DATABASE_URL, which would silently restore that reach.
export function getAdminLoginClient(): PrismaClient {
  if (adminLoginClient !== undefined) return adminLoginClient;

  const url = process.env[ADMIN_LOGIN_DATABASE_URL_ENV]?.trim();
  if (!url) {
    throw new Error(
      `${ADMIN_LOGIN_DATABASE_URL_ENV} is not set: the ${ADMIN_LOGIN_ROLE} role is not provisioned, ` +
        'so the panel cannot verify admin credentials. Set it to that role\'s connection string; ' +
        'there is deliberately no fallback to the application-wide connection.',
    );
  }

  // Actor-aware: admins is row-level secured on cms.actor, supplied by the system:auth scope.
  adminLoginClient = buildActorAwareClient(
    new PrismaClient({ datasourceUrl: url, log: ['error', 'warn'] }),
  );
  return adminLoginClient;
}

/** Distinct from the login variable: the two roles hold different columns. */
const ADMIN_READ_DATABASE_URL_ENV = 'ADMIN_READ_DATABASE_URL';

/** The role that variable connects as; restated in the failure so an operator can search for it. */
const ADMIN_READ_ROLE = 'cms_admin_read_people';

let adminReadClient: PrismaClient | undefined;

// Column-scoped read connection for the admins list: lazy, and no fallback to DATABASE_URL, which still holds the hash.
export function getAdminReadClient(): PrismaClient {
  if (adminReadClient !== undefined) return adminReadClient;

  const url = process.env[ADMIN_READ_DATABASE_URL_ENV]?.trim();
  if (!url) {
    throw new Error(
      `${ADMIN_READ_DATABASE_URL_ENV} is not set: the ${ADMIN_READ_ROLE} role is not provisioned, ` +
        'so the panel cannot list admins. Set it to that role\'s connection string; ' +
        'there is deliberately no fallback to the application-wide connection.',
    );
  }

  // Actor-aware: admins is row-level secured on cms.actor, supplied by the signed-in admin's request.
  adminReadClient = buildActorAwareClient(
    new PrismaClient({ datasourceUrl: url, log: ['error', 'warn'] }),
  );
  return adminReadClient;
}

/** Distinct from login and read: only this role may write an account. */
const ADMIN_SECURITY_DATABASE_URL_ENV = 'ADMIN_SECURITY_DATABASE_URL';

/** The role that variable connects as; restated in the failure so an operator can search for it. */
const ADMIN_SECURITY_ROLE = 'cms_admin_account_security';

let adminSecurityClient: PrismaClient | undefined;

// Write connection for admin accounts: lazy, and no fallback to DATABASE_URL, which still holds every column.
export function getAdminSecurityClient(): PrismaClient {
  if (adminSecurityClient !== undefined) return adminSecurityClient;

  const url = process.env[ADMIN_SECURITY_DATABASE_URL_ENV]?.trim();
  if (!url) {
    throw new Error(
      `${ADMIN_SECURITY_DATABASE_URL_ENV} is not set: the ${ADMIN_SECURITY_ROLE} role is not provisioned, ` +
        'so the panel cannot mutate admin accounts. Set it to that role\'s connection string; ' +
        'there is deliberately no fallback to the application-wide connection.',
    );
  }

  // Actor-aware: admins is row-level secured on cms.actor, supplied by the signed-in admin's request.
  adminSecurityClient = buildActorAwareClient(
    new PrismaClient({ datasourceUrl: url, log: ['error', 'warn'] }),
  );
  return adminSecurityClient;
}
