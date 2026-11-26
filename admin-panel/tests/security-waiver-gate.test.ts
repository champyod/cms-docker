import { describe, expect, it } from 'vitest';

import {
  MAX_EXPORT_AGE_DAYS,
  expiredWaivers,
  liveWaivers,
  parseWaiverExport,
  renderAuditIgnoreIds,
  renderTrivyIgnore,
  waiverGateFailure,
  type WaiverExport,
  type WaiverRecord,
} from '@/lib/security/waiver-gate';

const NOW = new Date('2026-10-25T00:00:00.000Z');
const SOON = '2027-01-31T00:00:00.000Z';
const LAPSED = '2026-10-01T00:00:00.000Z';

function waiver(overrides: Partial<WaiverRecord> = {}): WaiverRecord {
  return {
    id: 1,
    source: 'rootfs',
    match: 'CVE-2026-1',
    reason: 'vendor backport pending',
    reviewBy: SOON,
    createdAt: '2026-10-01T00:00:00.000Z',
    createdBy: 7,
    createdByName: 'root',
    endedAt: null,
    ...overrides,
  };
}

function exported(waivers: readonly WaiverRecord[], generatedAt = '2026-10-24T00:00:00.000Z'): WaiverExport {
  return { version: 1, generatedAt, waivers };
}

describe('waiver export boundary', () => {
  it('accepts a well-formed export and normalises its dates', () => {
    const parsed = parseWaiverExport({
      version: 1,
      generatedAt: '2026-10-24T09:00:00+07:00',
      waivers: [
        {
          id: 4,
          source: 'osv',
          match: ' GHSA-vfj7-8cjw-p6xm ',
          reason: ' no fixed release ',
          reviewBy: '2027-01-31',
          createdAt: '2026-10-24T00:00:00.000Z',
          createdBy: 1,
          createdByName: 'root',
          endedAt: null,
        },
      ],
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.generatedAt).toBe('2026-10-24T02:00:00.000Z');
    expect(parsed.value.waivers[0].match).toBe('GHSA-vfj7-8cjw-p6xm');
    expect(parsed.value.waivers[0].reason).toBe('no fixed release');
  });

  // The column refuses a waiver without a date; this is the same rule at the file boundary, where
  // a human can edit the document the gate reads.
  it('refuses a waiver with no review date, no reason, no owner or no match', () => {
    const base = {
      version: 1,
      generatedAt: '2026-10-24T00:00:00.000Z',
      waivers: [
        {
          id: 1,
          source: 'rootfs',
          match: 'CVE-2026-1',
          reason: 'why',
          reviewBy: SOON,
          createdAt: '2026-10-01T00:00:00.000Z',
          createdBy: 1,
          createdByName: 'root',
          endedAt: null,
        },
      ],
    };
    const without = (field: string): unknown => {
      const row = { ...base.waivers[0] } as Record<string, unknown>;
      delete row[field];
      return { ...base, waivers: [row] };
    };

    const dated = parseWaiverExport(without('reviewBy'));
    const gated = parseWaiverExport({ ...base, waivers: [{ ...base.waivers[0], reviewBy: 'soon' }] });
    const reasoned = parseWaiverExport(without('reason'));
    const owned = parseWaiverExport(without('createdBy'));
    const matched = parseWaiverExport(without('match'));

    expect([dated.ok, gated.ok, reasoned.ok, owned.ok, matched.ok]).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    if (!dated.ok) expect(dated.error).toContain('reviewBy');
    if (!dated.ok) expect(dated.error).toContain('never expires');
    if (!owned.ok) expect(owned.error).toContain('who');
    if (!matched.ok) expect(matched.error).toContain('what it covers');
  });

  it('refuses a hand-edited row that is ended, an unknown source, a duplicate or a stray version', () => {
    const ended = parseWaiverExport(exported([waiver({ endedAt: '2026-10-20T00:00:00.000Z' })]));
    const source = parseWaiverExport({
      ...exported([waiver()]),
      waivers: [{ ...waiver(), source: 'renovate' }],
    });
    const duplicate = parseWaiverExport(exported([waiver({ id: 3 }), waiver({ id: 3 })]));
    const version = parseWaiverExport({ ...exported([waiver()]), version: 99 });
    const shape = parseWaiverExport([waiver()]);

    expect([ended.ok, source.ok, duplicate.ok, version.ok, shape.ok]).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    if (!ended.ok) expect(ended.error).toContain('ended');
    if (!duplicate.ok) expect(duplicate.error).toContain('repeats id 3');
  });
});

describe('waiver expiry', () => {
  it('counts a waiver as live until its review date passes, and never after it ended', () => {
    const rows = [
      waiver({ id: 1, reviewBy: LAPSED }),
      waiver({ id: 2, reviewBy: SOON }),
      waiver({ id: 3, reviewBy: LAPSED, endedAt: '2026-10-02T00:00:00.000Z' }),
    ];

    expect(liveWaivers(rows, NOW).map((row) => row.id)).toEqual([2]);
    expect(expiredWaivers(rows, NOW).map((row) => row.id)).toEqual([1]);
  });

  it('names the id, the date and the signer of every expired waiver, oldest first', () => {
    const expired = expiredWaivers(
      [
        waiver({ id: 8, reviewBy: '2026-09-15T00:00:00.000Z', reason: 'second' }),
        waiver({ id: 4, reviewBy: LAPSED, reason: 'first', createdByName: null, createdBy: 12 }),
      ],
      NOW,
    );

    expect(expired.map((row) => row.id)).toEqual([8, 4]);
    expect(expired[1].reviewBy).toBe(LAPSED);
    expect(expired[0].reason).toBe('second');
    // A deleted account still shows a name: the id it was filed under, never a blank.
    expect(expired[1].owner).toBe('admin #12');
  });

  it('passes an export whose waivers are all in the future and is silent about a healthy one', () => {
    expect(waiverGateFailure(exported([waiver(), waiver({ id: 2, source: 'osv' })]), NOW)).toBeNull();
    expect(waiverGateFailure(exported([]), NOW)).toBeNull();
  });

  it('fails naming every expired id and date, not just counting them', () => {
    const failure = waiverGateFailure(
      exported([
        waiver({ id: 4, match: 'CVE-2026-78669', reviewBy: '2026-10-01T00:00:00.000Z' }),
        waiver({ id: 7, source: 'osv', match: 'GHSA-vfj7-8cjw-p6xm', reviewBy: '2026-10-20T00:00:00.000Z' }),
      ]),
      NOW,
    );

    expect(failure).not.toBeNull();
    expect(failure).toContain('2 waiver(s) are past their review date');
    expect(failure).toContain('#4 rootfs CVE-2026-78669 — review by 2026-10-01');
    expect(failure).toContain('#7 osv GHSA-vfj7-8cjw-p6xm — review by 2026-10-20');
    expect(failure).toContain('signed by root');
    expect(failure).toContain('end it');
  });

  it('fails an export nobody has re-rendered, and one dated in the future', () => {
    const stale = waiverGateFailure(
      exported([waiver()], '2026-08-01T00:00:00.000Z'),
      NOW,
    );
    const future = waiverGateFailure(exported([waiver()], '2026-11-30T00:00:00.000Z'), NOW);

    expect(stale).toContain(`${String(MAX_EXPORT_AGE_DAYS)}-day bound`);
    expect(stale).toContain('re-render security/waivers.json');
    expect(future).toContain('in the future');
  });
});

describe('the suppressions a waiver licenses', () => {
  it('renders only live rootfs waivers to the Trivy ignore file', () => {
    const body = renderTrivyIgnore(
      [
        waiver({ id: 1, match: 'CVE-2026-78669' }),
        // Expired: the id must be gone from the file, not merely flagged in the gate.
        waiver({ id: 2, match: 'CVE-2026-78667', reviewBy: LAPSED }),
        // Ended: the decision no longer exists.
        waiver({ id: 3, match: 'CVE-2026-97031', endedAt: '2026-10-20T00:00:00.000Z' }),
        // Another family: bun audit's, not Trivy's.
        waiver({ id: 4, source: 'osv', match: 'GHSA-vfj7-8cjw-p6xm' }),
        // A finding key rather than a bare id: Trivy matches the vulnerability id alone.
        waiver({ id: 5, match: 'CVE-2026-12345|compose' }),
      ],
      NOW,
    );

    expect(body).toContain('CVE-2026-78669');
    expect(body).toContain('CVE-2026-12345');
    expect(body).not.toContain('CVE-2026-78667');
    expect(body).not.toContain('CVE-2026-97031');
    expect(body).not.toContain('GHSA-vfj7-8cjw-p6xm');
    // Provenance per id: whoever renews knows whose decision it was and when it lapses.
    expect(body).toContain('# waiver #1 · review by 2027-01-31 · root: vendor backport pending');
    expect(body).toContain('GENERATED from the panel');
    expect(body).toContain('do not commit');
  });

  it('renders an empty ignore file when nothing is waived, rather than omitting the file', () => {
    const body = renderTrivyIgnore([], NOW);

    expect(body.startsWith('# GENERATED')).toBe(true);
    expect(body.trim().split('\n').filter((line) => !line.startsWith('#'))).toEqual([]);
  });

  it('renders only live osv advisories for bun audit', () => {
    const ids = renderAuditIgnoreIds(
      [
        waiver({ id: 1, match: 'CVE-2026-78669' }),
        waiver({ id: 2, source: 'osv', match: 'GHSA-vfj7-8cjw-p6xm' }),
        waiver({ id: 3, source: 'osv', match: 'GHSA-lapsed', reviewBy: LAPSED }),
        waiver({ id: 4, source: 'osv', match: 'GHSA-ended', endedAt: '2026-10-02T00:00:00.000Z' }),
      ],
      NOW,
    );

    expect(ids).toEqual(['GHSA-vfj7-8cjw-p6xm']);
  });
});
