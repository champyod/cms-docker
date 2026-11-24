import { describe, expect, it } from 'vitest';

import { buildSecurityDigest, SIGNAL_RULES } from '@/lib/security/signal';
import {
  currentStaleness,
  makeFinding,
  makeSignalFacts,
  makeWaiver,
  NOW,
  staleStaleness,
  unknownStalenessFixture,
} from './security-signal-fixture';

/** Pins the counts, the named item, and the one rule that lets a fact start a message. */
describe('security digest', () => {
  it('counts what the card shows and names the worst and the longest-standing item', () => {
    const digest = buildSecurityDigest(
      makeSignalFacts(
        [
          makeFinding(1, { severity: 'CRITICAL', subject: 'glibc', firstSeen: '2026-09-01T00:00:00.000Z' }),
          makeFinding(2, { severity: 'HIGH', subject: 'curl', firstSeen: '2026-10-23T00:00:00.000Z' }),
          makeFinding(3, { severity: 'MEDIUM', waiver: { status: 'active', reviewBy: '2026-12-01T00:00:00.000Z' } }),
          makeFinding(4, { source: 'diun', key: 'ghcr.io/example/nginx', kind: 'image', severity: null, subject: 'ghcr.io/example/nginx' }),
        ],
        [makeWaiver(7, { reviewBy: '2026-10-01T00:00:00.000Z', expired: true, match: 'CVE-2026-7' })],
      ),
      currentStaleness(),
      NOW,
    );

    expect(digest.counts.openFindings).toBe(4);
    expect(digest.counts.unwaivedCritical).toBe(1);
    expect(digest.counts.unwaivedHigh).toBe(1);
    expect(digest.counts.expiredWaivers).toBe(1);
    expect(digest.counts.staleImages).toBe(1);
    // The critical is the older unowned item, so it is the one named as oldest.
    expect(digest.worst?.label).toBe('rootfs glibc');
    expect(digest.worst?.detail).toContain('CRITICAL');
    expect(digest.worst?.detail).toContain('no waiver');
    expect(digest.oldest?.label).toBe('rootfs glibc');
    expect(digest.oldest?.ageDays).toBe(54);
    expect(digest.tone).toBe('act');
  });

  it('pushes the lapsed decision, the unwaived critical and the stale copy: nothing else', () => {
    const digest = buildSecurityDigest(
      makeSignalFacts(
        [
          makeFinding(1, { severity: 'CRITICAL' }),
          makeFinding(2, { severity: 'HIGH' }),
          makeFinding(3, { severity: 'MEDIUM', firstSeen: '2026-08-01T00:00:00.000Z' }),
          makeFinding(4, { source: 'diun', key: 'ghcr.io/example/api', kind: 'image', severity: null }),
        ],
        [makeWaiver(9, { reviewBy: '2026-10-02T00:00:00.000Z', expired: true, match: 'CVE-2026-9' })],
      ),
      staleStaleness(),
      NOW,
    );

    expect(digest.triggers.map((fact) => fact.key)).toEqual([
      'waiver:9:expired',
      'finding:rootfs:CVE-2026-1|openssl',
      'stale:backup',
    ]);
    // Riders are context, never a reason to send; they are counted, not listed.
    expect(digest.riderCounts).toEqual({
      unwaivedHigh: 1,
      aged: 1,
      staleImages: 1,
      expiringWaivers: 0,
    });
    expect(digest.counts.agedFindings).toBe(1);
  });

  it('counts a critical whose waiver lapsed as unwaived but pushes the waiver only once', () => {
    const digest = buildSecurityDigest(
      makeSignalFacts(
        [makeFinding(1, { severity: 'CRITICAL', waiver: { status: 'expired', reviewBy: '2026-10-01T00:00:00.000Z' } })],
        [makeWaiver(5, { reviewBy: '2026-10-01T00:00:00.000Z', expired: true })],
      ),
      currentStaleness(),
      NOW,
    );

    // The lapsed decision is the actionable fact, and the finding it covered still counts.
    expect(digest.triggers.map((fact) => fact.key)).toEqual(['waiver:5:expired']);
    expect(digest.counts.unwaivedCritical).toBe(1);
  });

  it('is quiet and green when nothing is push-worthy', () => {
    const digest = buildSecurityDigest(makeSignalFacts([], []), currentStaleness(), NOW);

    expect(digest.triggers).toEqual([]);
    expect(digest.riderCounts).toEqual({
      unwaivedHigh: 0,
      aged: 0,
      staleImages: 0,
      expiringWaivers: 0,
    });
    expect(digest.tone).toBe('clear');
    expect(digest.worst).toBeNull();
    expect(digest.oldest).toBeNull();
  });

  it('reports a reading it could not take as a trigger, never as a healthy one', () => {
    const digest = buildSecurityDigest(makeSignalFacts([], []), unknownStalenessFixture(), NOW);

    // No finding to act on: a card shouting for attention beside an empty list sends the operator hunting.
    expect(digest.tone).toBe('unevaluable');
    expect(digest.triggers.map((fact) => fact.key)).toEqual([
      'cannot-evaluate:backup',
      'cannot-evaluate:offsite',
    ]);
    expect(digest.triggers[0]?.detail).toContain('cannot evaluate');
    expect(digest.counts.unevaluable).toBe(2);
  });

  it('keeps a HIGH out of the triggers on its own, but names it on the page', () => {
    const onlyHigh = buildSecurityDigest(
      makeSignalFacts([makeFinding(1, { severity: 'HIGH', firstSeen: '2026-10-24T00:00:00.000Z' })]),
      currentStaleness(),
      NOW,
    );

    expect(onlyHigh.triggers).toEqual([]);
    expect(onlyHigh.tone).toBe('watch');
    expect(onlyHigh.counts.unwaivedHigh).toBe(1);
    expect(onlyHigh.worst?.label).toBe('rootfs openssl');
  });

  it('calls out a waiver that is about to lapse on the page only', () => {
    const digest = buildSecurityDigest(
      makeSignalFacts(
        [makeFinding(1, { severity: 'CRITICAL', waiver: { status: 'active', reviewBy: '2026-10-30T00:00:00.000Z' } })],
        [makeWaiver(4, { reviewBy: '2026-10-30T00:00:00.000Z' })],
      ),
      currentStaleness(),
      NOW,
    );

    // A live waiver suppresses the push, and the review date inside the window is the planning fact.
    expect(digest.triggers).toEqual([]);
    expect(digest.riderCounts.expiringWaivers).toBe(1);
    expect(digest.counts.expiringWaivers).toBe(1);
    expect(digest.riderCounts.unwaivedHigh).toBe(0);
    expect(SIGNAL_RULES.waiverWarningDays).toBe(7);
  });
});
