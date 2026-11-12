import { describe, expect, it } from 'vitest';

import {
  buildScanAnnouncement,
  DISCORD_BODY_LIMIT,
  SCAN_ALERT_COLOR,
  SCAN_CRITICAL_LINES,
  SCAN_REPORT_COLOR,
  scanRunKey,
  type ScanCriticalRow,
  type ScanRunFacts,
} from '@/lib/security/scan-report';

const RUN_AT = new Date('2026-11-12T03:00:00.000Z');

function critical(overrides: Partial<ScanCriticalRow> = {}): ScanCriticalRow {
  return {
    key: 'CVE-2026-1187|openssl',
    subject: 'openssl',
    waiver: 'none',
    reviewBy: null,
    ...overrides,
  };
}

function facts(overrides: Partial<ScanRunFacts> = {}): ScanRunFacts {
  return {
    source: 'rootfs',
    host: 'box-a',
    runStartedAt: RUN_AT,
    total: 42,
    added: 3,
    criticals: 1,
    counts: { high: 4, medium: 7, low: 12, unrated: 0 },
    waived: 5,
    criticalRows: [critical()],
    ...overrides,
  };
}

/** Every bullet that names a CRITICAL, without the counted remainder or the "none" line. */
function namedCriticalLines(body: string): string[] {
  return body
    .split('\n')
    .filter((line) => line.startsWith('• ') && !line.startsWith('• …and') && !line.startsWith('• No CRITICAL'));
}

describe('security scan announcement', () => {
  it('opens with the host, the run time, the total and how many were new', () => {
    const header = buildScanAnnouncement(facts()).body.split('\n')[0];

    expect(header).toContain('box-a');
    expect(header).toContain('2026-11-12 03:00 UTC');
    expect(header).toContain('42 findings');
    expect(header).toContain('3 new this run');
  });

  it('names one CRITICAL by its CVE and leaves the other severities as counts', () => {
    // The shape the operator asked for: the one thing that pages, by name; everything else summed.
    const { body } = buildScanAnnouncement(facts());

    expect(namedCriticalLines(body)).toEqual(['• openssl (CVE-2026-1187) — no waiver']);
    expect(body).not.toContain('CVE-2026-2201');
    expect(body.split('\n').at(-1)).toBe('HIGH 4 · MEDIUM 7 · LOW 12 · 5 waived');
  });

  it('says when a live waiver covers the named CRITICAL, and when one has lapsed', () => {
    const live = buildScanAnnouncement(
      facts({ criticalRows: [critical({ waiver: 'active', reviewBy: '2026-12-01T00:00:00.000Z' })] }),
    ).body;
    const lapsed = buildScanAnnouncement(
      facts({ criticalRows: [critical({ waiver: 'expired', reviewBy: '2026-10-01T00:00:00.000Z' })] }),
    ).body;

    expect(live).toContain('waived until 2026-12-01');
    expect(lapsed).toContain('waiver expired 2026-10-01');
  });

  it('trims thirty CRITICALs to ten names plus one counted remainder line', () => {
    const rows = Array.from({ length: SCAN_CRITICAL_LINES }, (_, index) =>
      critical({ key: `CVE-2026-${String(1000 + index)}|pkg-${String(index)}`, subject: `pkg-${String(index)}` }),
    );
    const { body } = buildScanAnnouncement(facts({ criticals: 30, criticalRows: rows }));

    expect(namedCriticalLines(body)).toHaveLength(SCAN_CRITICAL_LINES);
    expect(namedCriticalLines(body)[0]).toContain('CVE-2026-1000');
    expect(body).toContain('• …and 20 more CRITICAL on the patching page');
    // The tail survives: trimming names, not sentences.
    expect(body.split('\n').at(-1)).toBe('HIGH 4 · MEDIUM 7 · LOW 12 · 5 waived');
  });

  it('drops named CRITICALs — never characters — to stay inside the 2000-char cap', () => {
    const rows = Array.from({ length: SCAN_CRITICAL_LINES }, (_, index) =>
      critical({ key: `CVE-2026-${String(2000 + index)}|pkg-${String(index)}`, subject: `pkg-${String(index)}` }),
    );
    const { body } = buildScanAnnouncement(
      facts({ host: 'h'.repeat(1700), criticals: 30, criticalRows: rows }),
    );
    const named = namedCriticalLines(body);

    expect(body.length).toBeLessThanOrEqual(DISCORD_BODY_LIMIT);
    expect(named.length).toBeLessThan(SCAN_CRITICAL_LINES);
    expect(body).toContain(`• …and ${String(30 - named.length)} more CRITICAL on the patching page`);
    // Every surviving line is whole: id, subject and verdict, never a fragment of one.
    for (const line of named) expect(line).toMatch(/ — (no waiver|waived until \d{4}-\d{2}-\d{2}|waiver expired \d{4}-\d{2}-\d{2})$/);
    expect(body.split('\n').at(-1)).toBe('HIGH 4 · MEDIUM 7 · LOW 12 · 5 waived');
  });

  it('still speaks on a run that found nothing, and says so plainly', () => {
    const { body, mention, color } = buildScanAnnouncement(
      facts({
        total: 0,
        added: 0,
        criticals: 0,
        criticalRows: [],
        counts: { high: 0, medium: 0, low: 0, unrated: 0 },
        waived: 0,
      }),
    );

    expect(body).toContain('0 findings, 0 new this run');
    expect(body).toContain('• No CRITICAL findings.');
    expect(body).not.toContain('…and');
    expect(body.split('\n').at(-1)).toBe('HIGH 0 · MEDIUM 0 · LOW 0 · 0 waived');
    expect({ mention, color }).toEqual({ mention: false, color: SCAN_REPORT_COLOR });
  });

  it('mentions the role only when a named CRITICAL has no live decision', () => {
    const lapsed = buildScanAnnouncement(facts({ criticalRows: [critical({ waiver: 'expired' })] }));
    const waived = buildScanAnnouncement(
      facts({ criticalRows: [critical({ waiver: 'active', reviewBy: '2026-12-01T00:00:00.000Z' })] }),
    );

    expect(lapsed.mention).toBe(true);
    expect(lapsed.color).toBe(SCAN_ALERT_COLOR);
    expect(waived.mention).toBe(false);
    expect(waived.color).toBe(SCAN_REPORT_COLOR);
  });

  it('counts unrated rows in the tail rather than folding them into a severity', () => {
    const { body } = buildScanAnnouncement(facts({ counts: { high: 1, medium: 0, low: 0, unrated: 6 } }));

    expect(body).toContain('UNKNOWN 6');
  });

  it('keys a run by its source, host and start, so a re-push cannot read as a new run', () => {
    expect(scanRunKey('rootfs', 'box-a', RUN_AT)).toBe('rootfs|box-a|2026-11-12T03:00:00.000Z');
    expect(scanRunKey('rootfs', 'box-a', RUN_AT)).toBe(scanRunKey('rootfs', 'box-a', RUN_AT));
    expect(scanRunKey('rootfs', 'box-b', RUN_AT)).not.toBe(scanRunKey('rootfs', 'box-a', RUN_AT));
    expect(scanRunKey('rootfs', 'box-a', new Date(RUN_AT.getTime() + 1))).not.toBe(
      scanRunKey('rootfs', 'box-a', RUN_AT),
    );
    expect(scanRunKey('osv', null, RUN_AT)).toBe('osv|-|2026-11-12T03:00:00.000Z');
  });
});
