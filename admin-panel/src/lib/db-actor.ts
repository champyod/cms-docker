import { AsyncLocalStorage } from 'node:async_hooks';

/** Policies read the cms.actor GUC, so a connection that has not said who it is reads nothing; a missing actor fails closed. */

/** The named non-human identities. Restated in the generator's allowlists; see the migration. */
export const SYSTEM_IDENTITIES = {
  /** Pre-session login: verifying a credential and resolving its grants. */
  AUTH: 'system:auth',
  /** `./cms panel` and scripts/__panel_action.sh — a script-side write. */
  CLI: 'system:cli',
  /** The security feed's HTTP push; may only append and update findings. */
  INGEST: 'system:ingest',
  /** Seeding and migrations. */
  MIGRATION: 'system:migration',
  /** The backup scheduler: no request and no cookie, so it names itself. */
  SCHEDULER: 'system:scheduler',
  /** The retention service: the only identity allowed to prune audit_log. */
  AUDIT_RETENTION: 'system:audit-retention',
} as const;

export type SystemIdentity = (typeof SYSTEM_IDENTITIES)[keyof typeof SYSTEM_IDENTITIES];

export type DbActor =
  | { readonly kind: 'admin'; readonly id: number }
  | { readonly kind: 'system'; readonly name: SystemIdentity };

export const SYSTEM_ACTOR_NAMES: readonly string[] = Object.values(SYSTEM_IDENTITIES);

/** Raised when a query runs with no identity. Never caught to supply a default. */
export class MissingDbActorError extends Error {
  constructor(detail: string) {
    super(
      `no database actor: ${detail}. Every table is row-level secured on cms.actor, so this query ` +
        'would read nothing and write nothing: wrap the scope in withActor() (a signed-in panel ' +
        'request resolves its own actor from the session cookie).',
    );
    this.name = 'MissingDbActorError';
  }
}

/** The GUC value for an actor: `admin:<id>` or `system:<name>`. */
export function actorClaim(actor: DbActor): string {
  if (actor.kind === 'admin') {
    if (!Number.isInteger(actor.id) || actor.id <= 0) {
      throw new MissingDbActorError(`admin actor id ${String(actor.id)} is not a positive integer`);
    }
    return `admin:${actor.id}`;
  }
  if (!SYSTEM_ACTOR_NAMES.includes(actor.name)) {
    throw new MissingDbActorError(`unknown system identity ${String(actor.name)}`);
  }
  return actor.name;
}

/** AsyncLocalStorage, not a module variable: concurrent requests must not see each other's actor. */
type ActorStore = { actor: DbActor };

// Exported for db-actor-request.ts; the scope stays here so non-request processes can import this file safely.
export const actorStorage = new AsyncLocalStorage<ActorStore>();

/** The actor of the current scope, if one was established. */
export function currentDbActor(): DbActor | undefined {
  return actorStorage.getStore()?.actor;
}

/** A scope makes the identity a property of the work, so a new module inherits it instead of remembering one. */
export function withActor<T>(actor: DbActor, fn: () => PromiseLike<T>): Promise<T> {
  // Validated before the scope opens: a malformed identity must fail here, not at the first query.
  actorClaim(actor);
  return actorStorage.run({ actor }, async () => await fn());
}
