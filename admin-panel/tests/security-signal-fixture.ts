import {
  groupFindings,
  type PatchingFinding,
  type PatchingSeverity,
  type PatchingState,
  type PatchingWaiver,
} from '@/lib/security/patching';
import type { PatchingSource } from '@/lib/security/patching';
import type { StalenessSnapshot } from '@/lib/security/signal';

/** A fixed clock for every signal test, so an age is a number and not a race. */
export const NOW = new Date('2026-10-25T12:00:00.000Z');

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

/**
 * A state with the shared cards derived the way the read path derives them, so a test cannot assert a
 * count the page would not have produced.
 */
export function makeState(
  findings: readonly PatchingFinding[],
  waivers: readonly PatchingWaiver[] = [],
): PatchingState {
  return {
    groups: groupFindings(findings),
    waivers,
    cards: {
      staleImages: findings.filter((finding) => finding.source === 'diun').length,
      unresolvedCves: findings.filter((finding) => finding.source !== 'diun').length,
      expiredWaivers: waivers.filter((waiver) => waiver.expired).length,
      hostOsUpdates: 0,
    },
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
