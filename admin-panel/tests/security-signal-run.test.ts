import { describe, expect, it, vi } from 'vitest';

import { buildSecurityDigest, type PageRecord, type SecurityDigest } from '@/lib/security/signal';
import { runSignalTick, shouldReportReadFailure, READ_FAILURE_INTERVAL_MS } from '@/lib/security/signal-run';
import {
  currentStaleness,
  makeFinding,
  makeSignalFacts,
  makeWaiver,
  NOW,
  unknownStalenessFixture,
} from './security-signal-fixture';

function lapsed(): SecurityDigest {
  return buildSecurityDigest(
    makeSignalFacts(
      [makeFinding(1, { severity: 'MEDIUM', waiver: { status: 'expired', reviewBy: '2026-10-02T00:00:00.000Z' } })],
      [makeWaiver(9, { reviewBy: '2026-10-02T00:00:00.000Z', expired: true })],
    ),
    currentStaleness(),
    NOW,
  );
}

interface Harness {
  readonly sinks: Parameters<typeof runSignalTick>[0];
  readonly deliver: ReturnType<typeof vi.fn>;
  readonly recordPage: ReturnType<typeof vi.fn>;
  readonly readDigest: ReturnType<typeof vi.fn>;
  readonly logs: string[];
  last: PageRecord | null;
}

function harness(options: { digest?: () => Promise<SecurityDigest>; delivered?: boolean } = {}): Harness {
  let last: PageRecord | null = null;
  const logs: string[] = [];
  const deliver = vi.fn(async () => options.delivered ?? true);
  const recordPage = vi.fn(async (_digest: SecurityDigest, plan: { facts: readonly { key: string }[] }, now: Date) => {
    last = { notifiedAt: now.toISOString(), keys: plan.facts.map((fact) => fact.key) };
  });
  const readDigest = vi.fn(options.digest ?? (async () => lapsed()));
  return {
    sinks: {
      readDigest,
      readLastPage: async () => last,
      recordPage,
      deliver,
      now: () => NOW,
      log: (line) => logs.push(line),
    },
    deliver,
    recordPage,
    readDigest,
    logs,
    get last() {
      return last;
    },
  };
}

/**
 * The tick is where the four rules meet. These cases drive it with fakes so the contract is about
 * behaviour — one message, then silence, then a retry only when delivery actually failed — and not
 * about how the ports are wired.
 */
describe('security signal tick', () => {
  it('delivers once, records the facts it named, and is silent on the next tick', async () => {
    const fake = harness();

    const first = await runSignalTick(fake.sinks);
    expect(first.status).toBe('delivered');
    expect(fake.deliver).toHaveBeenCalledTimes(1);
    expect(fake.recordPage).toHaveBeenCalledTimes(1);

    const second = await runSignalTick(fake.sinks);
    expect(second.status).toBe('quiet');
    if (second.status === 'quiet') expect(second.plan.reason).toBe('unchanged');
    expect(fake.deliver).toHaveBeenCalledTimes(1);
    expect(fake.logs).toContain('security signal: quiet (unchanged)');
  });

  it('retries a fact whose delivery was refused instead of marking it as said', async () => {
    const fake = harness({ delivered: false });

    const first = await runSignalTick(fake.sinks);
    expect(first.status).toBe('undelivered');
    expect(fake.recordPage).not.toHaveBeenCalled();

    // Nothing was recorded, so the next tick still sees the fact as fresh.
    const second = await runSignalTick(fake.sinks);
    expect(second.status).toBe('undelivered');
    expect(fake.deliver).toHaveBeenCalledTimes(2);
  });

  it('reports an unreadable state and sends nothing, because there is nothing to diff against', async () => {
    const fake = harness({
      digest: async () => {
        throw new Error('no database actor: system:scheduler missing');
      },
    });

    const outcome = await runSignalTick(fake.sinks);
    expect(outcome.status).toBe('unreadable');
    expect(fake.deliver).not.toHaveBeenCalled();
    expect(fake.logs[0]).toContain('cannot read state');
  });

  it('says nothing when only page-worthy facts exist', async () => {
    const fake = harness({
      digest: async () => buildSecurityDigest(makeSignalFacts([makeFinding(1, { severity: 'HIGH' })]), currentStaleness(), NOW),
    });

    const outcome = await runSignalTick(fake.sinks);
    expect(outcome.status).toBe('quiet');
    if (outcome.status === 'quiet') expect(outcome.plan.reason).toBe('nothing-to-say');
    expect(fake.deliver).not.toHaveBeenCalled();
  });

  it('treats an unevaluable backup as push-worthy', async () => {
    const fake = harness({
      digest: async () => buildSecurityDigest(makeSignalFacts([]), unknownStalenessFixture(), NOW),
    });

    const outcome = await runSignalTick(fake.sinks);
    expect(outcome.status).toBe('delivered');
    if (outcome.status === 'delivered') {
      expect(outcome.plan.body).toContain('cannot evaluate');
    }
  });

  it('floors the "state unreadable" page so an outage is not one message a minute', () => {
    expect(shouldReportReadFailure(null, NOW)).toBe(true);
    expect(shouldReportReadFailure(new Date(NOW.getTime() - READ_FAILURE_INTERVAL_MS + 1000), NOW)).toBe(false);
    expect(shouldReportReadFailure(new Date(NOW.getTime() - READ_FAILURE_INTERVAL_MS), NOW)).toBe(true);
  });
});
