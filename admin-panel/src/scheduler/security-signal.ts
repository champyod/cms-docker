import { logToDiscord } from '@/lib/discord-notifier';
import { SYSTEM_IDENTITIES, withActor } from '@/lib/db-actor';
import { prisma } from '@/lib/prisma';
import { readPatchingSnapshot } from '@/lib/security/patching-read';
import { announceFinishedScans } from '@/lib/security/scan-notify';
import { readLastPage, recordPage } from '@/lib/security/signal-ledger';
import {
  runSignalTick,
  shouldReportReadFailure,
  type SignalOutcome,
  type SignalSinks,
} from '@/lib/security/signal-run';

/** Its own container: a background loop inside a Next server lives and dies with a request pod and duplicates per replica. */

const DEFAULT_TICK_SECONDS = 60;
const MIN_TICK_SECONDS = 30;
/** The database settles after the container boots; a failure that outlives the grace is still paged. */
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
  // The same function the panel page calls, inside the same actor scope.
  readDigest: async () => (await readPatchingSnapshot()).signal,
  readLastPage,
  recordPage,
  deliver: async (plan) => await logToDiscord(plan.title, plan.body, SIGNAL_COLOR, plan.mention),
  now: () => new Date(),
  log: (line) => console.log(line),
};

// The scan announcements of this tick, in their own guard: a refused webhook must not silence the digest.
async function announceScans(now: Date): Promise<void> {
  try {
    const results = await announceFinishedScans(now);
    for (const result of results) {
      if (result.status !== 'already-sent') console.log(`security scan ${result.key}: ${result.status}`);
    }
  } catch (error) {
    console.error('security scan announcement tick failed:', error);
  }
}

/** The dedupe keys live in the same store, so without this floor an outage would page on every tick. */
export async function runSecuritySignalTick(now: Date = new Date()): Promise<SignalOutcome> {
  await announceScans(now);
  const outcome = await runSignalTick(sinks);
  if (outcome.status !== 'unreadable') return outcome;
  if (Date.now() - STARTED_AT < READ_FAILURE_GRACE_MS) return outcome;
  if (!shouldReportReadFailure(lastReadFailureAt, now)) return outcome;
  const delivered = await logToDiscord(
    'Security signal cannot read its state',
    `The security digest could not be evaluated: ${outcome.error}. Nothing is being reported until this reads again: the Patching page shows the same failure.`,
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
    // Without a webhook every send returns false: a configuration state, not news, so it is said once at boot.
    console.warn('Security signal: no DISCORD_WEBHOOK_URL: the digest card is the only surface.');
  }
  console.log(`Security signal polling every ${String(seconds)}s.`);
  void runSecuritySignalTick().catch((error: unknown) => {
    console.error('Security signal first tick failed:', error);
  });
}

void withActor({ kind: 'system', name: SYSTEM_IDENTITIES.SCHEDULER }, async () => {
  startSecuritySignal();
});
