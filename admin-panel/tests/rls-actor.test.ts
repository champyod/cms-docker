import { describe, expect, it } from 'vitest';

// The client module constructs a PrismaClient at import time, which validates the datasource URL.
// Nothing here connects — the fake base below is what every assertion runs against — so a URL that
// points nowhere is enough, and it must exist before the import is evaluated.
vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgresql://actor:actor@127.0.0.1:1/actor_test';
});

import { vi } from 'vitest';

import {
  MissingDbActorError,
  SYSTEM_IDENTITIES,
  actorClaim,
  currentDbActor,
  withActor,
} from '@/lib/db-actor';
// WHY from the request module: reading the cookie needs next/headers, which is why the identity
// rules and the cookie read are separate modules.
import { requireDbActor } from '@/lib/db-actor-request';
import { buildActorAwareClient } from '@/lib/prisma';

/**
 * What these tests pin: the mechanism, not the policies.
 *
 * The policies themselves are proved against a real Postgres by tests/test_rls_actor_enforcement.sh
 * (same query, with and without the actor). What cannot be proved there is that the panel's calls
 * CARRY an identity at all — the wrapper could be perfect and still be bypassed by a call that took
 * a different path to the database. So the assertions here are about what reaches the connection:
 * the stamp statement, in which order, with which claim, and what happens when there is no actor.
 */

interface Call {
  readonly kind: string;
  readonly detail: string;
}

/**
 * A stand-in for PrismaClient that records every statement it is asked to run.
 *
 * WHY a hand-written fake rather than a mock of the real client: what matters is the SHAPE of the
 * traffic (stamp first, then the model verb, inside one transaction), and a spy on the real client
 * would record library internals instead of that shape.
 */
function fakeBase(rows: unknown[] = [{ id: 1 }, { id: 2 }]) {
  const calls: Call[] = [];

  const delegate = (): Record<string, unknown> => ({
    findMany: async () => {
      calls.push({ kind: 'findMany', detail: '' });
      return rows;
    },
    findUnique: async () => {
      calls.push({ kind: 'findUnique', detail: '' });
      return rows[0] ?? null;
    },
    update: async () => {
      calls.push({ kind: 'update', detail: '' });
      return rows[0] ?? null;
    },
  });

  const executeRaw = async (_strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ kind: 'stamp', detail: String(values[0] ?? '') });
    return 0;
  };

  const transaction = async (arg: unknown) => {
    if (typeof arg === 'function') {
      const tx = {
        admins: delegate(),
        audit_log: delegate(),
        $executeRaw: executeRaw,
        $queryRaw: executeRaw,
      };
      return (arg as (client: unknown) => Promise<unknown>)(tx);
    }
    const results: unknown[] = [];
    for (const item of arg as unknown[]) results.push(await item);
    return results;
  };

  const base = {
    admins: delegate(),
    audit_log: delegate(),
    $executeRaw: executeRaw,
    $queryRaw: executeRaw,
    $transaction: transaction,
  };

  return { base: base as never, calls };
}

describe('the database actor', () => {
  it('formats an admin as admin:<id> and a system identity by its name', () => {
    expect(actorClaim({ kind: 'admin', id: 7 })).toBe('admin:7');
    expect(actorClaim({ kind: 'system', name: SYSTEM_IDENTITIES.INGEST })).toBe('system:ingest');
  });

  it('refuses an admin id the SQL could not parse instead of formatting it', () => {
    // The policies only read '^admin:[0-9]{1,9}$'. Formatting 0 or a NaN would send a claim that
    // matches no predicate — an empty result set that looks like an empty database, which is the
    // failure mode this whole change is trying to make impossible to reach silently.
    expect(() => actorClaim({ kind: 'admin', id: 0 })).toThrow(MissingDbActorError);
    expect(() => actorClaim({ kind: 'admin', id: Number.NaN })).toThrow(MissingDbActorError);
    expect(() => actorClaim({ kind: 'admin', id: -3 })).toThrow(MissingDbActorError);
  });

  it('refuses a system identity the policies do not name', () => {
    expect(() =>
      actorClaim({ kind: 'system', name: 'system:not-in-the-allowlist' as never }),
    ).toThrow(MissingDbActorError);
  });

  it('has no actor outside a scope and no session cookie', async () => {
    expect(currentDbActor()).toBeUndefined();
    await expect(requireDbActor()).rejects.toBeInstanceOf(MissingDbActorError);
  });

  it('scopes the actor to the callback and restores nothing after it', async () => {
    const seen = await withActor({ kind: 'admin', id: 12 }, async () => currentDbActor());
    expect(seen).toEqual({ kind: 'admin', id: 12 });
    expect(currentDbActor()).toBeUndefined();
  });

  it('lets the innermost scope win', async () => {
    const inner = await withActor({ kind: 'admin', id: 1 }, () =>
      withActor({ kind: 'system', name: SYSTEM_IDENTITIES.CLI }, async () => currentDbActor()),
    );
    expect(inner).toEqual({ kind: 'system', name: SYSTEM_IDENTITIES.CLI });
  });

  it('cannot leak one scope into another running at the same time', async () => {
    // WHY this is the important one: a module-level "current actor" would pass every other test in
    // this file and still hand one request's identity to another. Only interleaving two scopes
    // proves the identity travels with the async context.
    const slow = (actor: { kind: 'admin'; id: number }, ms: number) =>
      withActor(actor, async () => {
        await new Promise((resolve) => setTimeout(resolve, ms));
        return currentDbActor();
      });
    const [first, second] = await Promise.all([
      slow({ kind: 'admin', id: 1 }, 20),
      slow({ kind: 'admin', id: 2 }, 5),
    ]);
    expect(first).toEqual({ kind: 'admin', id: 1 });
    expect(second).toEqual({ kind: 'admin', id: 2 });
  });
});

describe('the actor-aware client', () => {
  it('stamps the transaction before running the query', async () => {
    const { base, calls } = fakeBase();
    const client = buildActorAwareClient(base);

    const rows = await withActor({ kind: 'admin', id: 7 }, () => client.admins.findMany());

    expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
    expect(calls).toEqual([
      { kind: 'stamp', detail: 'admin:7' },
      { kind: 'findMany', detail: '' },
    ]);
  });

  it('sends the named system identity as the claim', async () => {
    const { base, calls } = fakeBase();
    const client = buildActorAwareClient(base);

    await withActor({ kind: 'system', name: SYSTEM_IDENTITIES.INGEST }, () =>
      client.audit_log.findMany(),
    );

    expect(calls[0]).toEqual({ kind: 'stamp', detail: 'system:ingest' });
  });

  it('refuses to run at all with no actor, instead of returning nothing', async () => {
    // WHY an error and not an empty array: with the policies in place both look identical to the
    // caller, so the cheap behaviour (return []) would make a forgotten scope indistinguishable
    // from a genuinely empty table across the whole panel. Throwing names the fault at its source.
    const { base, calls } = fakeBase();
    const client = buildActorAwareClient(base);

    await expect(client.admins.findMany()).rejects.toBeInstanceOf(MissingDbActorError);
    expect(calls).toEqual([]);
  });

  it('stamps an explicit transaction once, at its start', async () => {
    const { base, calls } = fakeBase();
    const client = buildActorAwareClient(base);

    await withActor({ kind: 'admin', id: 3 }, () =>
      client.$transaction(async (tx: unknown) => {
        const scoped = tx as { admins: { findMany: () => Promise<unknown> } };
        await scoped.admins.findMany();
        await scoped.admins.findMany();
      }),
    );

    // One stamp for the caller's transaction, not one per statement inside it.
    expect(calls.filter((c) => c.kind === 'stamp')).toHaveLength(1);
    expect(calls.filter((c) => c.kind === 'findMany')).toHaveLength(2);
    expect(calls[0]).toEqual({ kind: 'stamp', detail: 'admin:3' });
  });

  it('stamps the batch form of $transaction before its statements', async () => {
    const { base, calls } = fakeBase();
    const client = buildActorAwareClient(base);

    await withActor({ kind: 'admin', id: 4 }, () =>
      client.$transaction([client.admins.findMany() as never]),
    );

    expect(calls[0]).toEqual({ kind: 'stamp', detail: 'admin:4' });
    expect(calls.map((c) => c.kind)).toContain('findMany');
  });

  it('stamps the raw verbs too, because they reach tables without a model', async () => {
    const { base, calls } = fakeBase();
    const client = buildActorAwareClient(base);

    await withActor({ kind: 'system', name: SYSTEM_IDENTITIES.CLI }, () =>
      client.$queryRaw`SELECT id FROM users WHERE id = ${1}`,
    );

    expect(calls[0]).toEqual({ kind: 'stamp', detail: 'system:cli' });
  });
});
