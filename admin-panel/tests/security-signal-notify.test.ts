import { describe, expect, it } from 'vitest';

import {
  buildSecurityDigest,
  planNotification,
  renderMessage,
  SIGNAL_RULES,
  type PageRecord,
  type SecurityDigest,
} from '@/lib/security/signal';
import {
  currentStaleness,
  makeFinding,
  makeState,
  makeWaiver,
  NOW,
  staleStaleness,
  unknownStalenessFixture,
} from './security-signal-fixture';

function digestOf(findings: Parameters<typeof makeState>[0], waivers: Parameters<typeof makeState>[1] = []): SecurityDigest {
  return buildSecurityDigest(makeState(findings, waivers), currentStaleness(), NOW);
}

function lapsedWaiverDigest(id = 9): SecurityDigest {
  return digestOf(
    [makeFinding(1, { severity: 'MEDIUM', waiver: { status: 'expired', reviewBy: '2026-10-02T00:00:00.000Z' } })],
    [makeWaiver(id, { reviewBy: '2026-10-02T00:00:00.000Z', expired: true, match: 'CVE-2026-9' })],
  );
}

function pageOf(at: Date, keys: readonly string[]): PageRecord {
  return { notifiedAt: at.toISOString(), keys };
}

/**
 * Dedupe is the whole reason the channel can be trusted: the same lapsed waiver must not page every
 * sixty seconds, a fact that was already said must stay said, and a fact that is *new* must not be
 * swallowed by a floor meant for flapping producers.
 */
describe('security notification plan', () => {
  it('sends when a push-worthy fact has not been said before', () => {
    const plan = planNotification(lapsedWaiverDigest(), null, NOW);

    expect(plan.send).toBe(true);
    expect(plan.reason).toBe('send');
    expect(plan.fresh.map((fact) => fact.key)).toEqual(['waiver:9:expired']);
    expect(plan.title).toBe('Security: 1 item need attention');
    expect(plan.body).toContain('review was due 2026-10-02');
  });

  it('stays quiet when the same fact is still the only one — every tick, forever', () => {
    const digest = lapsedWaiverDigest();
    const first = planNotification(digest, null, NOW);
    expect(first.send).toBe(true);

    const last = pageOf(NOW, first.facts.map((fact) => fact.key));
    // A day later, and a week later, with nothing changed: no message.
    for (const later of [60_000, 24 * 3600_000, 7 * 24 * 3600_000]) {
      const repeat = planNotification(digest, last, new Date(NOW.getTime() + later));
      expect(repeat.send).toBe(false);
      expect(repeat.reason).toBe('unchanged');
      expect(repeat.body).toBe('');
    }
  });

  it('sends again when a new fact joins an already-reported one, and names both', () => {
    const before = lapsedWaiverDigest(9);
    const last = pageOf(NOW, before.triggers.map((fact) => fact.key));
    const after = digestOf(
      [
        makeFinding(1, { severity: 'MEDIUM', waiver: { status: 'expired', reviewBy: '2026-10-02T00:00:00.000Z' } }),
        makeFinding(2, { severity: 'CRITICAL', subject: 'glibc' }),
      ],
      [makeWaiver(9, { reviewBy: '2026-10-02T00:00:00.000Z', expired: true, match: 'CVE-2026-9' })],
    );

    const plan = planNotification(after, last, new Date(NOW.getTime() + 11 * 60_000));

    expect(plan.send).toBe(true);
    expect(plan.fresh.map((fact) => fact.key)).toEqual(['finding:rootfs:CVE-2026-2|openssl']);
    // The message carries the whole state, not only the new line, so the operator is not left
    // guessing whether the older item was fixed.
    expect(plan.facts).toHaveLength(2);
    expect(plan.body).toContain('waiver CVE-2026-9');
    expect(plan.body).toContain('glibc');
    expect(plan.body).toContain('1 of these is new since the last message');
  });

  it('holds a new fact for the rate-limit floor instead of paging on every tick of a flap', () => {
    const last = pageOf(NOW, []);
    const fresh = lapsedWaiverDigest();

    const tooSoon = planNotification(fresh, last, new Date(NOW.getTime() + SIGNAL_RULES.minIntervalMs - 1000));
    expect(tooSoon.send).toBe(false);
    expect(tooSoon.reason).toBe('rate-limited');

    const afterFloor = planNotification(fresh, last, new Date(NOW.getTime() + SIGNAL_RULES.minIntervalMs));
    expect(afterFloor.send).toBe(true);
  });

  it('says nothing at all when nothing is push-worthy', () => {
    const clean = buildSecurityDigest(makeState([makeFinding(1, { severity: 'HIGH' })]), currentStaleness(), NOW);
    const plan = planNotification(clean, null, NOW);

    expect(plan.send).toBe(false);
    expect(plan.reason).toBe('nothing-to-say');
    expect(plan.facts).toEqual([]);
  });

  it('mentions the role for a critical or an unreadable backup, but not for a lapsed waiver alone', () => {
    expect(planNotification(lapsedWaiverDigest(), null, NOW).mention).toBe(false);
    expect(planNotification(digestOf([makeFinding(2, { severity: 'CRITICAL' })]), null, NOW).mention).toBe(true);
    expect(
      planNotification(buildSecurityDigest(makeState([]), unknownStalenessFixture(), NOW), null, NOW).mention,
    ).toBe(true);
  });

  it('caps the message and counts the rest instead of printing forty lines', () => {
    const many = Array.from({ length: SIGNAL_RULES.maxLines + 3 }, (_, index) =>
      makeFinding(index + 1, { severity: 'CRITICAL', subject: `pkg-${String(index + 1)}` }),
    );
    const digest = buildSecurityDigest(makeState(many), staleStaleness(), NOW);

    const lines = renderMessage(digest, digest.triggers).split('\n');
    const factLines = lines.filter((line) => line.startsWith('• ') && !line.includes('…and'));
    expect(factLines).toHaveLength(SIGNAL_RULES.maxLines);
    expect(lines.join('\n')).toContain(`…and ${String(digest.triggers.length - SIGNAL_RULES.maxLines)} more`);
  });

  it('summarises the page-only facts in one counted line', () => {
    const digest = digestOf([
      makeFinding(1, { severity: 'CRITICAL' }),
      makeFinding(2, { severity: 'HIGH' }),
      makeFinding(3, { severity: 'HIGH', subject: 'zlib' }),
    ]);

    const body = renderMessage(digest, digest.triggers);
    expect(body).toContain('Also on the page: 2 unwaived HIGH.');
  });
});
