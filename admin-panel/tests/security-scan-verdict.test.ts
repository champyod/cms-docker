import { describe, expect, it } from 'vitest';

import {
  buildScanAnnouncement,
  SCAN_ALERT_COLOR,
  SCAN_REPORT_COLOR,
  SCAN_WARN_COLOR,
  type ScanRunFacts,
} from '@/lib/security/scan-report';

/**
 * Why these exist: an unwaived HIGH is unfixed and unwaived, and the first version of the
 * announcement called that "nothing needs you" in green. The verdict has three tiers, and each
 * one is pinned here so the calm reading can never again be printed over standing work.
 */
function facts(over: Partial<ScanRunFacts> & { high?: number; highWithFix?: number } = {}): ScanRunFacts {
  const high = over.high ?? 0;
  const highWithFix = over.highWithFix ?? 0;
  return {
    host: 'box-a',
    runStartedAt: new Date('2026-11-12T03:00:00Z'),
    lastPushAt: new Date('2026-11-12T03:04:00Z'),
    standing: high + (over.criticals ?? 0) + 612,
    added: 0,
    criticals: 0,
    counts: { high, highWithFix, medium: 612, low: 233, unrated: 4 },
    waived: 881,
    nextReview: '2027-01-31',
    criticalRows: [],
    judged: { reachable: 0, unreachable: 0, unknown: 0 },
    ...over,
  };
}

describe('the announcement changes tier with what is actually unwaived', () => {
  it('names standing unwaived HIGH amber, never "nothing needs you"', () => {
    const message = buildScanAnnouncement(facts({ high: 1415, highWithFix: 12 }));
    expect(message.title).toBe('1,415 HIGH findings need a decision · box-a');
    expect(message.color).toBe(SCAN_WARN_COLOR);
    expect(message.mention).toBe(false);
    expect(message.body.split('\n')[0]).toContain('12 can be patched — patch or accept');
    expect(message.body).not.toContain('all MEDIUM/LOW or accepted');
  });

  it('says there is nothing to apply when no fixed version exists', () => {
    // Production on 2026-11-13: 1,415 unwaived HIGH and not one carrying an `available` version —
    // 1,105 of them the same 221 kernel CVEs. "Patch or accept" was advice nobody could act on.
    const message = buildScanAnnouncement(facts({ high: 1415, highWithFix: 0 }));
    expect(message.title).toBe('1,415 HIGH findings await an upstream fix · box-a');
    expect(message.color).toBe(SCAN_WARN_COLOR);
    expect(message.body.split('\n')[0]).toContain('no patch exists yet — nothing to apply today');
  });

  it('keeps the singular readable', () => {
    const message = buildScanAnnouncement(facts({ high: 1, highWithFix: 1 }));
    expect(message.title).toBe('1 HIGH findings need a decision · box-a');
    expect(message.body.split('\n')[0]).toContain('1 can be patched — patch or accept');
  });

  it('reds and pings when an unwaived CRITICAL outranks the HIGH list', () => {
    const message = buildScanAnnouncement(facts({ high: 900, criticals: 3 }));
    expect(message.title).toBe('3 CRITICAL findings need action now · box-a');
    expect(message.color).toBe(SCAN_ALERT_COLOR);
    expect(message.mention).toBe(true);
    expect(message.body.split('\n')[0]).toContain('fix these today');
  });

  it('earns the calm green line only below HIGH', () => {
    const message = buildScanAnnouncement(facts({ high: 0 }));
    expect(message.title).toBe('Nothing needs action · box-a');
    expect(message.color).toBe(SCAN_REPORT_COLOR);
    expect(message.body.split('\n')[0]).toContain('all MEDIUM/LOW or accepted');
  });
});