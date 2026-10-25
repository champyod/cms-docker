import { PrismaClient } from '@prisma/client';

import { actorClaim } from '@/lib/db-actor';

/** See {@link buildActorAwareClient}. */
export { buildActorAwareClient };

/**
 * The one database connection the panel uses, wrapped so that every statement carries an identity.
 *
 * WHY a wrapper and not a helper every caller must remember: 141 modules import this client, and
 * the fail-closed policies mean the module that forgets does not "see too much" — it sees nothing,
 * silently, and the page it powers draws empty. A missing actor would then be indistinguishable
 * from an empty database. So the identity is made structural: nothing reaches Postgres except
 * through a transaction that stamps `cms.actor` first, and a call with no identity raises
 * `MissingDbActorError` at the call site instead of returning [].
 *
 * HOW the stamp survives a pooled connection: `set_config('cms.actor', $1, true)` is
 * transaction-local. Each model call runs inside its own `$transaction`, so the setting is applied
 * after BEGIN and discarded at COMMIT (or ROLLBACK) — the next borrower of that connection cannot
 * inherit the previous request's identity. A session-scoped `SET` would have been one line and one
 * cross-request authorization bug, which is why it is not used anywhere in this file.
 *
 * WHAT IT COSTS: a read is now BEGIN / set_config / SELECT / COMMIT instead of SELECT — two extra
 * round trips per statement. That is the price of moving enforcement into the database while the
 * connection is shared; it is recorded as an open risk, with a per-request connection role as the
 * structural fix.
 */

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

/**
 * The statement that stamps a transaction. Parameterised: the claim is never interpolated.
 *
 * WHY $queryRaw and not $executeRaw: `set_config` returns the value it set, so the statement has a
 * result set. `$executeRaw` is for statements that only report an affected-row count.
 *
 * WHY bound to its client: a template tag is called as a plain function, so an unbound method loses
 * its receiver and Prisma's implementation then dereferences `this` (`_createPrismaPromise`) as
 * undefined. Bun happens to keep the receiver; node — which is what the poller image runs — does not,
 * and the failure appeared the first time this path was exercised outside a request (the security
 * signal's first run). Binding is exactly the receiver a direct call would have had.
 */
function stamp(client: AnyClient, claim: string): Promise<unknown> {
  const queryRaw = (client['$queryRaw'] as (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<unknown>).bind(client);
  return queryRaw`SELECT set_config('cms.actor', ${claim}, true)`;
}

/**
 * A query the caller has not awaited yet, tagged with how to run it.
 *
 * WHY not just return the promise: `prisma.$transaction([a, b])` is used by four modules in this
 * codebase, and Prisma rejects an array whose elements are not its own PrismaPromises. A promise
 * that has already started also cannot be moved into somebody else's transaction — atomicity would
 * be lost while looking correct. So the call is deferred: awaiting it runs the statement in its own
 * stamped transaction, and handing it to `$transaction` runs it, with its siblings, in ONE stamped
 * transaction.
 */
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
  /**
   * Run `operation` in a transaction stamped with the resolved actor.
   *
   * WHY every call opens a transaction even for a single read: `SET LOCAL` needs a transaction to
   * be scoped to, and there is no other per-request scope on a shared pool. The alternative —
   * setting the GUC once per request on a checked-out connection — requires holding a connection
   * for the whole request, which Prisma's pool does not offer.
   */
  async function inActorTransaction<T>(
    operation: (tx: AnyClient, claim: string) => Promise<T>,
  ): Promise<T> {
    // WHY the import is dynamic: the request actor is resolved from the session cookie, which lives
    // in `next/headers` and only exists inside a request. A static import would make every
    // non-request process that loads this client — the backup scheduler, the CLI, the waiver export,
    // the image's own `tsx -e 'require("@/lib/prisma")'` smoke check — fail at import time.
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
    // The three Promise methods a caller may reach for before awaiting. `then` is what `await`
    // uses; `catch` and `finally` are provided so a call site that chains them keeps working
    // (a bare `PromiseLike` would not).
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
        // WHY `apply(tx, args)`: Prisma's raw verbs are *methods* on the transaction client — they
        // read `this._createPrismaPromise`, so calling the extracted function unbound throws
        // "undefined is not an object". Passing the receiver through is what makes a top-level
        // `prisma.$queryRaw` work at all (the statement still runs inside the stamped transaction).
        return (...args: unknown[]) =>
          defer(async (tx) => {
            const fn = tx[prop] as unknown as (...a: unknown[]) => Promise<unknown>;
            return await fn.apply(tx, args);
          });
      }

      // $transaction is special: the caller is asking for atomicity across statements, so the
      // actor is stamped once at the top of THEIR transaction rather than around each statement.
      if (prop === '$transaction') {
        return (arg: unknown) => {
          if (typeof arg === 'function') {
            return inActorTransaction((tx) =>
              (arg as (client: unknown) => Promise<unknown>)(tx),
            );
          }
          const items = arg as unknown[];
          if (!items.every(isDeferred)) {
            // WHY refuse rather than fall through: passing a foreign promise into Prisma's batch
            // would run it OUTSIDE the stamped transaction, so the caller would get atomicity it
            // did not actually have. A loud error is the only honest answer.
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
  // Why: query-level logging buries the surrounding deploy output (the permission
  // seed alone prints hundreds of statements); errors and warnings stay enabled so
  // a failed seed still reports its cause.
  log: ['error', 'warn'],
});

const globalForPrisma = global as unknown as { prisma: PrismaClient };

/**
 * The module's client. Typed as `PrismaClient` because it is one, verb for verb — the wrapper adds
 * the actor transaction around each call and changes no signature.
 */
export const prisma: PrismaClient =
  process.env.NODE_ENV !== 'production'
    ? (globalForPrisma.prisma ??= buildActorAwareClient(baseClient))
    : buildActorAwareClient(baseClient);

/**
 * The unwrapped client, for the entry points that must ESTABLISH an identity rather than inherit
 * one: `withActor(…)` needs a client to run its first statement on, and the seed/CLI wrappers are
 * outside any request.
 *
 * WHY exported at all: hiding it would push those entry points to construct a second
 * `PrismaClient` — a second pool, its own connection limits, and a client that bypasses this file
 * entirely. It is not a bypass: statements through it are still row-level secured, so using it
 * without an actor reads nothing.
 */
export const prismaUnscoped: PrismaClient = baseClient;
