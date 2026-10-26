import {
  buildPatchingCards,
  type PatchingFinding,
  type PatchingSeverity,
  type PatchingSource,
  type PatchingWaiver,
} from '@/lib/security/patching';
import {
  agedCutoff,
  SIGNAL_RULES,
  type PatchingSignalFacts,
  type StalenessSnapshot,
} from '@/lib/security/signal';

/** A fixed clock for every signal test, so an age is a number and not a race. */
export const NOW = new Date('2026-10-25T12:00:00.000Z');

const DAY_MS = 24 * 60 * 60 * 1000;

export function makeFinding(
  id: number,
  overrides: Partial<PatchingFinding> & { readonly source?: PatchingSource; readonly severity?: PatchingSeverity | null } = {},
): PatchingFinding {
  return {
    id,
    source: 'rootfs',
    key: `CVE-2026-${String(id)}|openssl`,
    kind: 'os-package',
    severity: 'MEDIUM',
    subject: 'openssl',
    installed: '1.0',
    available: '1.1',
    title: `CVE-2026-${String(id)}`,
    url: null,
    host: 'box-a',
    firstSeen: '2026-10-20T00:00:00.000Z',
    lastSeen: '2026-10-24T00:00:00.000Z',
    waiver: { status: 'none' },
    ...overrides,
  };
}

export function makeWaiver(
  id: number,
  overrides: Partial<PatchingWaiver> = {},
): PatchingWaiver {
  return {
    id,
    source: 'rootfs',
    match: `CVE-2026-${String(id)}`,
    reason: 'waiting on the vendor backport',
    reviewBy: '2026-12-01T00:00:00.000Z',
    createdAt: '2026-09-01T00:00:00.000Z',
    createdBy: 1,
    createdByName: 'root',
    endedAt: null,
    expired: false,
    ...overrides,
  };
}

/** Severity rank, so "the worst" is decided the way the page decides it. */
const SEVERITY_RANK: Record<PatchingSeverity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  UNKNOWN: 4,
};

function rank(finding: PatchingFinding): number {
  return finding.severity === null ? 99 : SEVERITY_RANK[finding.severity];
}

function isAged(finding: PatchingFinding): boolean {
  return new Date(finding.firstSeen).getTime() <= agedCutoff(NOW).getTime();
}

/**
 * The facts a read path would hand the digest, derived from rows.
 *
 * WHY this exists: the digest no longer sees every finding — it sees aggregates plus the few rows a
 * message can name, because a real feed holds tens of thousands of rows. A test that wants to say
 * "this feed, this digest" therefore has to build the same view SQL builds: the counts are the
 * aggregate, the lists are what the read's `take` returns. What "unwaived" or "aged" MEANS is still
 * decided in `signal.ts`, so this helper cannot disagree with production about it.
 */
export function makeSignalFacts(
  findings: readonly PatchingFinding[],
  waivers: readonly PatchingWaiver[] = [],
): PatchingSignalFacts {
  const bySource: Record<PatchingSource, number> = { diun: 0, rootfs: 0, osv: 0 };
  const bySeverity: Record<PatchingSeverity, number> = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    UNKNOWN: 0,
  };
  let unrated = 0;
  for (const finding of findings) {
    bySource[finding.source] += 1;
    if (finding.severity === null) unrated += 1;
    else bySeverity[finding.severity] += 1;
  }

  const untouched = findings.filter((finding) => finding.waiver.status === 'none');
  // "The worst" is the most severe row, ties to the earliest sighting — the row the read's
  // `orderBy: first_seen asc` on the top severity returns.
  const worst =
    [...findings].sort((left, right) => {
      const byRank = rank(left) - rank(right);
      return byRank !== 0 ? byRank : left.firstSeen.localeCompare(right.firstSeen);
    })[0] ?? null;
  const oldest =
    [...untouched].sort((left, right) => left.firstSeen.localeCompare(right.firstSeen))[0] ?? null;
  const pushed = untouched.filter(
    (finding) =>
      finding.severity !== null &&
      (SIGNAL_RULES.pushSeverities as readonly PatchingSeverity[]).includes(finding.severity),
  );

  return {
    // The cards are derived by the production function from the same aggregate the read produces,
    // so a test cannot assert a count the page would not have shown. `review_by` is derived from the
    // fixture's own `expired` flag because that flag is what the fixture states as the verdict.
    cards: buildPatchingCards(
      {
        bySource,
        rootfsWithAvailable: findings.filter(
          (finding) => finding.source === 'rootfs' && finding.available !== null,
        ).length,
      },
      waivers.map((waiver) => ({
        ended_at: null,
        review_by: new Date(NOW.getTime() + (waiver.expired ? -DAY_MS : DAY_MS)),
      })),
      NOW,
    ),
    waivers,
    bySource,
    bySeverity,
    unrated,
    aged: findings.filter(isAged).length,
    waived: findings.filter((finding) => finding.waiver.status !== 'none'),
    criticals: pushed
      .sort((left, right) => left.firstSeen.localeCompare(right.firstSeen))
      .slice(0, SIGNAL_RULES.maxLines),
    worst,
    oldest,
  };
}

function reading(
  channel: 'backup' | 'offsite',
  state: 'current' | 'stale' | 'unknown',
  ageSeconds: number | null,
  detail: string | null,
): StalenessSnapshot['readings'][number] {
  return { channel, state, ageSeconds, observedAtSeconds: Math.floor(NOW.getTime() / 1000), detail };
}

/** Both copies current, which is the only reading that lets a digest read as healthy. */
export function currentStaleness(): StalenessSnapshot {
  return {
    readings: [
      reading('backup', 'current', 4 * 3600, null),
      reading('offsite', 'current', 6 * 3600, null),
    ],
    source: 'http://prometheus:9090',
  };
}

export function staleStaleness(): StalenessSnapshot {
  return {
    readings: [
      reading('backup', 'stale', 30 * 3600, 'newest proven copy is 30h old (window 26h)'),
      reading('offsite', 'current', 6 * 3600, null),
    ],
    source: 'http://prometheus:9090',
  };
}

export function unknownStalenessFixture(reason = 'Prometheus is not reachable at http://prometheus:9090'): StalenessSnapshot {
  return {
    readings: [
      reading('backup', 'unknown', null, reason),
      reading('offsite', 'unknown', null, reason),
    ],
    source: null,
  };
}
