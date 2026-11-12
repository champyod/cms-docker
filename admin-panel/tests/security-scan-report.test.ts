import { describe, expect, it } from 'vitest';

import {
  buildScanAnnouncement,
  DISCORD_BODY_LIMIT,
  PATCHING_PATH,
  SCAN_ALERT_COLOR,
  SCAN_CRITICAL_LINES,
  SCAN_REPORT_COLOR,
  scanRunKey,
  type ScanCriticalRow,
  type ScanRunFacts,
} from '@/lib/security/scan-report';

// The five levels the operator asked for, asserted as text: the message is the product here.

const RUN_AT = new Date('2026-11-12T03:00:00.000Z');
const LAST_PUSH_AT = new Date('2026-11-12T03:04:12.000Z');

function row(overrides: Partial<ScanCriticalRow> = {}): ScanCriticalRow {
  return {
    key: 'CVE-2023-53867|libxml2',
    subject: 'libxml2',
    reachability: 'reachable',
    ageDays: 412,
    ...overrides,
  };
}

function facts(overrides: Partial<ScanRunFacts> = {}): ScanRunFacts {
  return {
    host: 'box-a',
    runStartedAt: RUN_AT,
    lastPushAt: LAST_PUSH_AT,
    standing: 13_357,
    added: 34,
    criticals: 3,
    counts: { high: 1_415, medium: 612, low: 233, unrated: 0 },
    waived: 881,
    nextReview: '2027-01-31',
    criticalRows: [row()],
    judged: { reachable: 900, unreachable: 12, unknown: 6 },
    ...overrides,
  };
}

/** The fenced L4 block, as the lines a reader sees. */
function countBlock(body: string): string[] {
  return body.split('```')[1].split('\n').slice(1, -1);
}

function namedRows(body: string): string[] {
  return body.split('\n').filter((line) => line.startsWith('**CVE'));
}

describe('the scan announcement layout', () => {
  const tokens = (lines: readonly string[]): string[][] => lines.map((line) => line.trim().split(/\s+/));

  it('L1 says what to do, in plain words, and turns the bar red', () => {
    const { title, color, mention } = buildScanAnnouncement(facts());

    expect(title).toBe('3 CRITICAL findings need action now · box-a');
    expect(color).toBe(SCAN_ALERT_COLOR);
    expect(mention).toBe(true);
  });

  it('L2 leads with the open total, then the delta, then how urgent it is', () => {
    expect(buildScanAnnouncement(facts()).body.split('\n')[0]).toBe(
      '**13,357 open** · 34 new · fix these today',
    );
  });

  it('L3 names a row as CVE, subject and age, and counts the ones it did not name', () => {
    const { body } = buildScanAnnouncement(facts());

    expect(namedRows(body)).toEqual(['**CVE-2023-53867** · libxml2 · 412d']);
    expect(body).toContain('…and 2 more');
  });

  it('L3 keeps the order it was given — reachable first is the read path’s job', () => {
    const rows = [
      row({ key: 'CVE-2026-0001|openssl', subject: 'openssl', reachability: 'reachable' }),
      row({ key: 'CVE-2026-0002|glibc', subject: 'glibc', reachability: 'unreachable' }),
    ];
    const { body } = buildScanAnnouncement(facts({ criticals: 2, criticalRows: rows }));

    expect(namedRows(body).map((line) => line.split(' · ')[0])).toEqual(['**CVE-2026-0001**', '**CVE-2026-0002**']);
  });

  it('L4 groups the count by what the reader should do with it', () => {
    expect(tokens(countBlock(buildScanAnnouncement(facts()).body))).toEqual([
      ['act', 'now', '3', 'CRITICAL'],
      ['decide', '1,415', 'HIGH'],
      ['noted', '845', 'MEDIUM', '612', '·', 'LOW', '233'],
      ['accepted', '881', 're-check', '2027-01-31'],
    ]);
  });

  it('L4 names the unranked rows as unknown instead of inventing a rank', () => {
    const { body } = buildScanAnnouncement(facts({ counts: { high: 1, medium: 0, low: 0, unrated: 6 } }));

    expect(tokens(countBlock(body))).toEqual([
      ['act', 'now', '3', 'CRITICAL'],
      ['decide', '1', 'HIGH'],
      ['noted', '6', 'MEDIUM', '0', '·', 'LOW', '0', '·', 'unknown', '6'],
      ['accepted', '881', 're-check', '2027-01-31'],
    ]);
  });

  it('L5 carries the run clock, its duration, the judged split and the page', () => {
    expect(buildScanAnnouncement(facts()).footer).toBe(
      `run 2026-11-12 03:00 UTC · 4m12s · 900 reachable · 12 unreachable · 6 unknown · ${PATCHING_PATH}`,
    );
  });

  it('renders a clean run as the same skeleton, short: green bar, no named rows', () => {
    const { title, body, color, mention } = buildScanAnnouncement(
      facts({
        standing: 0,
        added: 0,
        criticals: 0,
        criticalRows: [],
        counts: { high: 0, medium: 0, low: 0, unrated: 0 },
        waived: 881,
      }),
    );

    expect(title).toBe('Nothing needs action · box-a');
    expect({ color, mention }).toEqual({ color: SCAN_REPORT_COLOR, mention: false });
    expect(body.split('\n')[0]).toBe('**0 open** · 0 new · all MEDIUM/LOW or accepted');
    expect(body).not.toContain('…and');
    expect(namedRows(body)).toEqual([]);
    expect(tokens(countBlock(body))).toEqual([
      ['act', 'now', '0', 'CRITICAL'],
      ['decide', '0', 'HIGH'],
      ['noted', '0', 'MEDIUM', '0', '·', 'LOW', '0'],
      ['accepted', '881', 're-check', '2027-01-31'],
    ]);
  });

  it('asks for a decision while unwaived HIGH stands, and only calms below it', () => {
    expect(buildScanAnnouncement(facts({ criticals: 1 })).body).toContain('fix these today');
    const calm = { high: 0, medium: 612, low: 233, unrated: 0 };
    expect(buildScanAnnouncement(facts({ criticals: 0, counts: calm, criticalRows: [] })).body).toContain(
      'all MEDIUM/LOW or accepted',
    );
    expect(buildScanAnnouncement(facts({ criticals: 0, criticalRows: [] })).body).toContain(
      'not urgent, but unfixed — patch or accept',
    );
  });

  it('names at most SCAN_CRITICAL_LINES rows and stays inside the Discord cap', () => {
    const rows = Array.from({ length: SCAN_CRITICAL_LINES + 3 }, (_, index) =>
      row({ key: `CVE-2026-${String(1000 + index)}|pkg-${'x'.repeat(60)}`, subject: 'pkg-'.repeat(12) }),
    );
    const { body } = buildScanAnnouncement(facts({ criticals: 40, criticalRows: rows }));

    expect(namedRows(body)).toHaveLength(SCAN_CRITICAL_LINES);
    expect(body).toContain(`…and ${String(40 - SCAN_CRITICAL_LINES)} more`);
    expect(body.length).toBeLessThanOrEqual(DISCORD_BODY_LIMIT);
  });

  it('keys a run by box and start alone, so one run’s two sources cannot split it', () => {
    expect(scanRunKey('box-a', RUN_AT)).toBe('box-a|2026-11-12T03:00:00.000Z');
    expect(scanRunKey('box-a', RUN_AT)).toBe(scanRunKey('box-a', RUN_AT));
    expect(scanRunKey('box-b', RUN_AT)).not.toBe(scanRunKey('box-a', RUN_AT));
    expect(scanRunKey(null, RUN_AT)).toBe('-|2026-11-12T03:00:00.000Z');
  });
});
