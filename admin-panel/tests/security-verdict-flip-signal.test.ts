import { describe, expect, it } from 'vitest';

import { buildSecurityDigest, planNotification, SIGNAL_RULES, waiverFlipKey } from '@/lib/security/signal';
import type { WaivedReachable } from '@/lib/security/verdict-flip';
import {
  currentStaleness,
  makeFinding,
  makeSignalFacts,
  makeWaiver,
  NOW,
} from './security-signal-fixture';

/**
 * The flip as the channel says it: one fact for the whole set, naming the count and the worst CVE,
 * deduplicated against the last message exactly like every other fact.
 *
 * WHY the count and the key are asserted together: this fact stands for a SET. A key that did not
 * move with the set would make the second hidden CVE silent, which is the failure the fact exists
 * to end — so "the count changed" must read as new.
 */

function flips(count: number, worst: Partial<NonNullable<WaivedReachable['worst']>> = {}): WaivedReachable {
  return {
    count,
    worst:
      count === 0
        ? null
        : {
            key: 'CVE-2026-7|linux',
            title: 'kernel: ksmbd: ksmbd_write error',
            subject: 'linux',
            severity: 'CRITICAL',
            host: 'como-main',
            flippedAt: '2026-11-10T09:00:00.000Z',
            ...worst,
          },
  };
}

describe('the digest pushes one fact for the flipped set', () => {
  it('names the count and the worst row, and ranks it above an unwaived critical', () => {
    const digest = buildSecurityDigest(
      makeSignalFacts([makeFinding(1, { severity: 'CRITICAL' })], [], flips(3)),
      currentStaleness(),
      NOW,
    );

    const flip = digest.triggers.find((fact) => fact.kind === 'waiver-flip');
    expect(flip).toEqual({
      key: waiverFlipKey(3, 'CVE-2026-7|linux'),
      kind: 'waiver-flip',
      detail: '3 waived finding(s) reachable now — worst CRITICAL kernel: ksmbd: ksmbd_write error on como-main',
      since: '2026-11-10T09:00:00.000Z',
    });
    // The unwaived critical is still pushed, and the flip leads: a decision that no longer fits
    // is the one thing here a reader cannot discover from a count.
    expect(digest.triggers[0]?.kind).toBe('waiver-flip');
    expect(digest.triggerCount).toBe(2);
  });

  it('says nothing at all when the set is empty', () => {
    const digest = buildSecurityDigest(makeSignalFacts([]), currentStaleness(), NOW);
    expect(digest.triggers.some((fact) => fact.kind === 'waiver-flip')).toBe(false);
    expect(digest.triggerCount).toBe(0);
    expect(digest.tone).toBe('clear');
  });

  it('does not repeat itself while the set is unchanged, and speaks again when it grows', () => {
    const small = buildSecurityDigest(makeSignalFacts([], [], flips(3)), currentStaleness(), NOW);
    const first = planNotification(small, null, NOW);
    expect(first.send).toBe(true);

    const record = { notifiedAt: NOW.toISOString(), keys: first.facts.map((fact) => fact.key) };
    const unchanged = planNotification(small, record, new Date(NOW.getTime() + SIGNAL_RULES.minIntervalMs));
    expect(unchanged.send).toBe(false);
    expect(unchanged.reason).toBe('unchanged');

    const grown = buildSecurityDigest(makeSignalFacts([], [], flips(4)), currentStaleness(), new Date(NOW.getTime() + SIGNAL_RULES.minIntervalMs));
    expect(planNotification(grown, record, new Date(NOW.getTime() + SIGNAL_RULES.minIntervalMs)).send).toBe(true);
  });

  it('mentions the role, because a reachable CVE under a waiver is not a page to open later', () => {
    const digest = buildSecurityDigest(makeSignalFacts([], [], flips(1)), currentStaleness(), NOW);
    expect(planNotification(digest, null, NOW).mention).toBe(true);
  });

  it('keeps a lapsed decision ahead of it: that one is already failing CI', () => {
    const digest = buildSecurityDigest(
      makeSignalFacts([], [makeWaiver(9, { expired: true, reviewBy: '2026-10-01T00:00:00.000Z' })], flips(2)),
      currentStaleness(),
      NOW,
    );
    expect(digest.triggers.map((fact) => fact.kind)).toEqual(['waiver-expired', 'waiver-flip']);
  });
});
