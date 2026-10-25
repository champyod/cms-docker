import { logToDiscord } from '@/lib/discord-notifier';
import { SYSTEM_IDENTITIES, withActor } from '@/lib/db-actor';
import { prisma } from '@/lib/prisma';
import { readPatchingSnapshot } from '@/lib/security/patching-read';
import { readLastPage, recordPage } from '@/lib/security/signal-ledger';
import {
  runSignalTick,
  shouldReportReadFailure,
  type SignalOutcome,
  type SignalSinks,
} from '@/lib/security/signal-run';

/**
 * The security signal: one long-lived container that turns the patching read into one Discord
 * message when — and only when — something push-worthy changed.
 *
 * WHY its own process and not a timer inside the panel: a Next server is a request handler, and a
 * background loop inside it lives and dies with a request-serving pod and duplicates per replica. It
 * is also the repo's standing rule — a new recurring check ships as a container service in an
 * existing optional overlay, never as a host script or a host daemon.
 *
 * WHY it reuses the poller image (docker/scheduler/Dockerfile): the decision needs the panel's own
 * read path (`readPatchingSnapshot`), its `PatchingState`, its dictionary-free digest and its
 * `logToDiscord`. A second implementation in another language would be a second definition of
 * "expired" and "stale" — exactly what the read path exists to prevent — so this is a second
 * *entry point* into the same compiled code, started with its own command.
 *
 * WHY the actor scope wraps the whole lifetime: every table is FORCE ROW LEVEL SECURITY on
 * `cms.actor`, and this process has no request and no cookie. The scope is opened once here, before
 * the first tick, so every query below runs as `system:scheduler` — a named service identity, never a
 * borrowed human one. A query outside the scope throws (`MissingDbActorError`) rather than reading
 * nothing, which is what makes that mistake visible instead of empty.
 */

const DEFAULT_TICK_SECONDS = 60;
const MIN_TICK_SECONDS = 30;
/**
 * How long after boot a failed read is logged but not paged.
 *
 * WHY: the container restarts with the stack, and the database is often still settling when the
 * first tick runs. Paging "cannot read its state" once per deploy would teach the operator that the
 * channel cries wolf at exactly the moment a deploy is happening — and a failure that outlives the
 * grace is still paged, because it is a failure, not a slow start.
 */
const READ_FAILURE_GRACE_MS = 60_000;
/** Same red the lockout and backup embeds use, so one channel does not speak in two palettes. */
const SIGNAL_COLOR = 15_158_332;
const STARTED_AT = Date.now();

function tickIntervalMs(): number {
  const seconds = Number.parseInt(process.env.SECURITY_SIGNAL_INTERVAL_SECONDS ?? '', 10);
  const resolved = Number.isFinite(seconds) && seconds >= MIN_TICK_SECONDS ? seconds : DEFAULT_TICK_SECONDS;
  return resolved * 1000;
}

let isTicking = false;
let isStopping = false;
/** In memory on purpose: a page about the store being unreadable cannot be recorded in the store. */
let lastReadFailureAt: Date | null = null;

const sinks: SignalSinks = {
  // The same function the panel page calls, inside the same actor scope: one read path, one
  // definition of what is unresolved.
  readDigest: async () => (await readPatchingSnapshot()).signal,
  readLastPage,
  recordPage,
  deliver: async (plan) => await logToDiscord(plan.title, plan.body, SIGNAL_COLOR, plan.mention),
  now: () => new Date(),
  log: (line) => console.log(line),
};

/**
 * One tick, exposed so an operator (or a test) can drive a single run without a loop.
 *
 * WHY an unreadable state is paged at most once per window: the store being down is not news that
 * changes every minute, and the dedupe keys live in that same store — so without this floor an
 * outage would page on every tick, which is the fastest way to make the channel worthless.
 */
export async function runSecuritySignalTick(now: Date = new Date()): Promise<SignalOutcome> {
  const outcome = await runSignalTick(sinks);
  if (outcome.status !== 'unreadable') return outcome;
  if (Date.now() - STARTED_AT < READ_FAILURE_GRACE_MS) return outcome;
  if (!shouldReportReadFailure(lastReadFailureAt, now)) return outcome;
  const delivered = await logToDiscord(
    'Security signal cannot read its state',
    `The security digest could not be evaluated: ${outcome.error}. Nothing is being reported until this reads again — the Patching page shows the same failure.`,
    SIGNAL_COLOR,
    true,
  );
  if (delivered) lastReadFailureAt = now;
  return outcome;
}

function startPolling(): NodeJS.Timeout {
  return setInterval(() => {
    if (isTicking || isStopping) return;
    isTicking = true;
    void runSecuritySignalTick()
      .catch((error: unknown) => {
        console.error('Security signal tick failed:', error);
      })
      .finally(() => {
        isTicking = false;
      });
  }, tickIntervalMs());
}

export function startSecuritySignal(): void {
  const timer = startPolling();
  const shutdown = (): void => {
    if (isStopping) return;
    isStopping = true;
    clearInterval(timer);
    process.off('SIGTERM', shutdown);
    process.off('SIGINT', shutdown);
    console.log('Security signal stopping.');
    void prisma.$disconnect().finally(() => {
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  const seconds = Math.round(tickIntervalMs() / 1000);
  if (process.env.DISCORD_WEBHOOK_URL === undefined || process.env.DISCORD_WEBHOOK_URL.trim() === '') {
    // Why said once at boot and not per tick: without a webhook every send returns false, so the
    // page is the only surface. That is a configuration state, not news — and saying it every
    // minute would drown the log lines that matter.
    console.warn('Security signal: no DISCORD_WEBHOOK_URL — the digest card is the only surface.');
  }
  console.log(`Security signal polling every ${String(seconds)}s.`);
  void runSecuritySignalTick().catch((error: unknown) => {
    console.error('Security signal first tick failed:', error);
  });
}

void withActor({ kind: 'system', name: SYSTEM_IDENTITIES.SCHEDULER }, async () => {
  startSecuritySignal();
});
