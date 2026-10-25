import {
  planNotification,
  type NotifyPlan,
  type PageRecord,
  type SecurityDigest,
} from '@/lib/security/signal';

/**
 * One tick of the security channel: read the state, decide, deliver, record.
 *
 * WHY the effects are injected: the tick is the only place the four rules meet (what is push-worthy,
 * what was already said, how often, and whether delivery actually happened), so a test has to drive
 * all four without a database, a socket or a webhook. Everything that touches the outside world is a
 * port; the decision itself lives in `signal.ts` and stays pure.
 *
 * WHY a failed read does not fall through to "nothing to say": with the state unreadable there is no
 * diff to make, so sending would either repeat the last message forever or claim all is well. The
 * tick reports `unreadable` and the loop pages at most once per
 * {@link READ_FAILURE_INTERVAL_MS} — an outage of the store is not a fact that flap-dedupes.
 */

export interface SignalSinks {
  /** The read path's answer: the digest, from `readPatchingSnapshot` (one query, one definition). */
  readonly readDigest: () => Promise<SecurityDigest>;
  readonly readLastPage: () => Promise<PageRecord | null>;
  readonly recordPage: (digest: SecurityDigest, plan: NotifyPlan, now: Date) => Promise<void>;
  /** True only when the message left the process and the receiver accepted it. */
  readonly deliver: (plan: NotifyPlan) => Promise<boolean>;
  readonly now: () => Date;
  readonly log: (line: string) => void;
}

export type SignalOutcome =
  | { readonly status: 'delivered'; readonly plan: NotifyPlan }
  | { readonly status: 'quiet'; readonly plan: NotifyPlan }
  | { readonly status: 'undelivered'; readonly plan: NotifyPlan; readonly error: string }
  | { readonly status: 'unreadable'; readonly error: string };

/** A quarter of an hour between "the state is unreadable" pages; the outage itself is not news. */
export const READ_FAILURE_INTERVAL_MS = 15 * 60 * 1000;

/** Whether an unreadable-state page is due, given when the last one went out. */
export function shouldReportReadFailure(lastAt: Date | null, now: Date): boolean {
  if (lastAt === null) return true;
  return now.getTime() - lastAt.getTime() >= READ_FAILURE_INTERVAL_MS;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runSignalTick(sinks: SignalSinks): Promise<SignalOutcome> {
  const now = sinks.now();

  let digest: SecurityDigest;
  let last: PageRecord | null;
  try {
    digest = await sinks.readDigest();
    last = await sinks.readLastPage();
  } catch (error: unknown) {
    const reason = describe(error);
    sinks.log(`security signal: cannot read state (${reason})`);
    return { status: 'unreadable', error: reason };
  }

  const plan = planNotification(digest, last, now);
  if (!plan.send) {
    // Why logged at all: "quiet" has three very different meanings (nothing wrong, nothing new,
    // holding a flood), and the log line is how an operator tells them apart without the channel.
    sinks.log(`security signal: quiet (${plan.reason})`);
    return { status: 'quiet', plan };
  }

  let delivered: boolean;
  try {
    delivered = await sinks.deliver(plan);
  } catch (error: unknown) {
    const reason = describe(error);
    sinks.log(`security signal: delivery failed (${reason})`);
    return { status: 'undelivered', plan, error: reason };
  }
  if (!delivered) {
    // Why no record: the keys are only written after the receiver accepted the message, so an
    // undelivered fact stays fresh and is retried on the next tick instead of being marked as said.
    sinks.log('security signal: notifier did not accept the message; will retry');
    return { status: 'undelivered', plan, error: 'notifier did not accept the message' };
  }

  try {
    await sinks.recordPage(digest, plan, now);
  } catch (error: unknown) {
    // The message is out; failing to record it means the next tick may repeat it once. Saying so is
    // better than throwing away the fact that a human was told.
    sinks.log(`security signal: delivered but not recorded (${describe(error)})`);
  }
  return { status: 'delivered', plan };
}
