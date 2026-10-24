import { startScheduler } from '@/scheduler/runner';
import { SYSTEM_IDENTITIES, withActor } from '@/lib/db-actor';

/**
 * Process entry point for the poller image. `runner.ts` stays importable, so
 * nothing but this file can start the polling loop.
 *
 * WHY the whole loop runs inside withActor(): every table is row-level secured on
 * `cms.actor`, and this process has no request and no cookie to resolve one from.
 * The scope is opened once and covers every tick, because the scheduler's identity
 * is the same for its whole lifetime — it is a service, not a person — and it is
 * named rather than borrowing a human one, so the audit trail says who really acted.
 */
void withActor({ kind: 'system', name: SYSTEM_IDENTITIES.SCHEDULER }, async () => {
  startScheduler();
});
