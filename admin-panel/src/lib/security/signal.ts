import type { PatchingFinding, PatchingSeverity, PatchingState } from '@/lib/security/patching';

/**
 * What deserves to reach a human, and how loudly.
 *
 * WHY this module is pure: the panel card, the Discord digest and the tests all have to answer
 * "what is wrong right now" the same way, so the answer is computed once from the state the read
 * path already returns. It takes no database, no network and no clock of its own — `now` is an
 * argument — so a test drives a year of drift in a millisecond and the card cannot start
 * disagreeing with the channel about what counts.
 *
 * THE PUSH RULE, and why the list is short. A notification is only worth its noise if ignoring it
 * has a cost that grows by the hour:
 *
 *   · **A lapsed waiver** — the decision ran out, the CI waiver gate fails from that moment, and
 *     the finding it covered is back to unowned. It is the cheapest thing on this list to fix and
 *     the one that stops every deploy.
 *   · **An unresolved CRITICAL with no live waiver** — the class where "the next Renovate PR will
 *     bump it" is not a plan. HIGH rides along in the same message but never starts one: HIGH is
 *     the ordinary state of an unpatched distro image between two daily bumps, so paging on it is
 *     how a channel becomes unreadable in a week.
 *   · **A backup or offsite copy that is stale, or that cannot be evaluated** — the only fact here
 *     that cannot be repaired after the fact. Silence is not reassurance: a monitoring stack that
 *     cannot be reached is reported as `cannot evaluate`, never as healthy.
 *
 * Everything else belongs on the page, where it is read on purpose:
 *
 *   · a waiver **expiring** within {@link SIGNAL_RULES.waiverWarningDays} — an advance warning is
 *     planning, and it becomes a push the moment it actually lapses;
 *   · an unwaived **HIGH** — see above;
 *   · a finding **older than** {@link SIGNAL_RULES.findingAgeDays} — age is a prioritisation
 *     signal, not an event; the finding already had its chance to page when it was CRITICAL, and
 *     "this is still 40 days old" repeats a fact the operator can see;
 *   · a **stale image** (Diun) — image drift is routine and Renovate owns the action, so paging it
 *     would page the same 6 images every cycle;
 *   · MEDIUM/LOW/UNKNOWN, and every per-waiver detail.
 *
 * The channel therefore carries at most one message per {@link SIGNAL_RULES.minIntervalMs}, and
 * nothing at all while the push set is unchanged (see `planNotification`).
 */

/** How loud the current state is, worst first. The card's colour and the channel both read it. */
export type SignalTone = 'act' | 'unevaluable' | 'watch' | 'clear';

export type SignalFactKind = 'waiver-expired' | 'finding-critical' | 'staleness';

/**
 * One thing worth saying, with a key that is stable for as long as the fact is.
 *
 * WHY a key and not just text: the channel is deduplicated by comparing the current keys with the
 * ones the last message carried, so the key must identify the *fact* (this waiver lapsed) and not
 * the sentence (which contains a date that moves). `waiver:12:expired` is the same fact tomorrow.
 */
export interface SignalFact {
  readonly key: string;
  readonly kind: SignalFactKind;
  /** One line naming the item, as it reads in the message. */
  readonly detail: string;
  /** When it began: the lapsed review date, the first sighting, the last proven run. */
  readonly since: string | null;
}

export type StalenessChannel = 'backup' | 'offsite';

/**
 * `current` is the publisher's own verdict that the newest copy is inside its window; `stale` is
 * its verdict that it is not; `unknown` means nothing could be read, which is never folded into
 * `current` (fail closed).
 */
export type StalenessState = 'current' | 'stale' | 'unknown';

export interface StalenessReading {
  readonly channel: StalenessChannel;
  readonly state: StalenessState;
  /** Seconds since the newest proven copy, as the publisher measured it. */
  readonly ageSeconds: number | null;
  /** Unix time the publisher wrote its state file; null when nothing was readable. */
  readonly observedAtSeconds: number | null;
  /** Why this is not `current`, in words the operator can act on. */
  readonly detail: string | null;
}

export interface StalenessSnapshot {
  readonly readings: readonly StalenessReading[];
  /** What answered — the scrape target, or null when none did. */
  readonly source: string | null;
}

/** A count the card shows, and the reason it is on the card at all. */
export interface SignalCounts {
  readonly openFindings: number;
  /** CRITICAL with no *live* waiver: an expired waiver suppresses nothing. */
  readonly unwaivedCritical: number;
  readonly unwaivedHigh: number;
  readonly expiredWaivers: number;
  /** Live waivers whose review date is inside the warning window but not yet past it. */
  readonly expiringWaivers: number;
  /** Unwaived findings older than the age threshold. */
  readonly agedFindings: number;
  readonly staleImages: number;
  /** Channels reporting `stale`. */
  readonly staleSources: number;
  /** Channels that could not be evaluated at all. */
  readonly unevaluable: number;
}

/** The one item the card names, so the digest is a sentence and not only numbers. */
export interface SignalLead {
  readonly label: string;
  readonly detail: string;
  readonly since: string | null;
  readonly ageDays: number | null;
}

export interface SecurityDigest {
  readonly tone: SignalTone;
  readonly counts: SignalCounts;
  /** The most severe unresolved item, whatever its waiver state. */
  readonly worst: SignalLead | null;
  /** The item that has been wrong the longest: the oldest unowned thing. */
  readonly oldest: SignalLead | null;
  /** Facts that start a message. */
  readonly triggers: readonly SignalFact[];
  /** Facts named in a message that some other fact started. Never a reason to send one. */
  readonly riders: readonly SignalFact[];
  readonly staleness: readonly StalenessReading[];
}

export const SIGNAL_RULES = {
  /** Severities that page on their own. See the module comment for why HIGH is not here. */
  pushSeverities: ['CRITICAL'] as const satisfies readonly PatchingSeverity[],
  /** A live waiver this close to its review date is called out on the page, not pushed. */
  waiverWarningDays: 7,
  /** An unwaived finding this old is called out as aged on the page. */
  findingAgeDays: 14,
  /**
   * One message per window, however many facts arrive.
   *
   * WHY a floor at all when the set is already deduplicated: a producer's partial push can resolve
   * a row and the next complete push can bring it back, which makes the same fact "new" again
   * seconds later. Ten minutes absorbs a flap without ever leaving a real fact unsaid — it is only
   * deferred to the next tick, and the page shows it immediately.
   */
  minIntervalMs: 10 * 60 * 1000,
  /** Detail lines in one message. A burst of forty CVEs is one message, not forty. */
  maxLines: 12,
} as const;

const SEVERITY_ORDER: Record<PatchingSeverity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  UNKNOWN: 4,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** A waiver suppresses a finding only while it is unexpired; a lapsed one suppresses nothing. */
function isUnwaived(finding: PatchingFinding): boolean {
  return finding.waiver.status !== 'active';
}

function ageDays(since: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(since).getTime()) / DAY_MS);
}

function findingDetail(finding: PatchingFinding): string {
  const title = finding.title === null ? '' : ` (${finding.title})`;
  return `${finding.source} · ${finding.subject}${title}`;
}

function findingLabel(finding: PatchingFinding): string {
  return `${finding.source} ${finding.subject}`;
}

/** The push key for a finding: the producer's own identity, never the rendered sentence. */
export function findingKey(finding: Pick<PatchingFinding, 'source' | 'key'>): string {
  return `finding:${finding.source}:${finding.key}`;
}

/** The push key for a lapsed waiver; `expired` keeps it distinct from its `expiring` rider. */
export function expiredWaiverKey(waiverId: number): string {
  return `waiver:${String(waiverId)}:expired`;
}

/**
 * Builds the digest from the read path's state plus the staleness snapshot.
 *
 * WHY the two inputs and not a query each: `PatchingState` is already the one answer to "what is
 * unresolved and what is waived", and staleness is not a finding (docs/SECURITY-FEED.md — a backup
 * age is not a finding), so it arrives as its own reading instead of being squeezed into either
 * security table.
 */
export function buildSecurityDigest(
  state: PatchingState,
  staleness: StalenessSnapshot,
  now: Date,
): SecurityDigest {
  const findings = state.groups.flatMap((group) => group.findings);
  const triggers: SignalFact[] = [];
  const riders: SignalFact[] = [];

  const expiredWaivers = state.waivers.filter((waiver) => waiver.expired);
  for (const waiver of expiredWaivers) {
    triggers.push({
      key: expiredWaiverKey(waiver.id),
      kind: 'waiver-expired',
      detail: `${waiver.source} waiver ${waiver.match} — review was due ${waiver.reviewBy.slice(0, 10)}`,
      since: waiver.reviewBy,
    });
  }

  const critical = findings.filter(
    (finding) => finding.severity !== null && SIGNAL_RULES.pushSeverities.includes(finding.severity as 'CRITICAL'),
  );
  // WHY only the ones with no waiver at all: a CRITICAL whose waiver lapsed is already pushed as
  // the lapsed decision, and one item producing two lines is how a digest starts to look like noise.
  for (const finding of critical.filter((row) => row.waiver.status === 'none')) {
    triggers.push({
      key: findingKey(finding),
      kind: 'finding-critical',
      detail: findingDetail(finding),
      since: finding.firstSeen,
    });
  }

  for (const reading of staleness.readings) {
    if (reading.state === 'current') continue;
    triggers.push({
      key: reading.state === 'stale' ? `stale:${reading.channel}` : `cannot-evaluate:${reading.channel}`,
      kind: 'staleness',
      detail:
        reading.state === 'stale'
          ? `${reading.channel}: ${reading.detail ?? 'stale'}`
          : `${reading.channel}: cannot evaluate — ${reading.detail ?? 'no reading'}`,
      since:
        reading.state === 'stale' && reading.observedAtSeconds !== null
          ? new Date(reading.observedAtSeconds * 1000).toISOString()
          : null,
    });
  }

  for (const finding of findings) {
    if (!isUnwaived(finding)) continue;
    if (finding.severity === 'HIGH') {
      riders.push({
        key: `high:${findingKey(finding)}`,
        kind: 'finding-critical',
        detail: findingDetail(finding),
        since: finding.firstSeen,
      });
    }
    if (ageDays(finding.firstSeen, now) > SIGNAL_RULES.findingAgeDays) {
      riders.push({
        key: `aged:${findingKey(finding)}`,
        kind: 'finding-critical',
        detail: `${findingDetail(finding)} — first seen ${finding.firstSeen.slice(0, 10)}`,
        since: finding.firstSeen,
      });
    }
  }

  // Diun's drift is a rider, never a trigger; it carries no severity, so it is named by subject.
  for (const finding of findings.filter((row) => row.source === 'diun')) {
    riders.push({
      key: `image:${finding.key}`,
      kind: 'finding-critical',
      detail: `${finding.subject} is not the digest the registry serves`,
      since: finding.firstSeen,
    });
  }

  const warningCutoff = now.getTime() + SIGNAL_RULES.waiverWarningDays * DAY_MS;
  const expiringWaivers = state.waivers.filter(
    (waiver) => !waiver.expired && new Date(waiver.reviewBy).getTime() <= warningCutoff,
  );
  for (const waiver of expiringWaivers) {
    riders.push({
      key: `waiver:${String(waiver.id)}:expiring`,
      kind: 'waiver-expired',
      detail: `${waiver.source} waiver ${waiver.match} — review due ${waiver.reviewBy.slice(0, 10)}`,
      since: waiver.reviewBy,
    });
  }

  const counts: SignalCounts = {
    openFindings: findings.length,
    unwaivedCritical: critical.filter(isUnwaived).length,
    unwaivedHigh: findings.filter((finding) => finding.severity === 'HIGH' && isUnwaived(finding)).length,
    expiredWaivers: expiredWaivers.length,
    expiringWaivers: expiringWaivers.length,
    agedFindings: findings.filter(
      (finding) => isUnwaived(finding) && ageDays(finding.firstSeen, now) > SIGNAL_RULES.findingAgeDays,
    ).length,
    // From the shared cards so the digest cannot count stale images differently from the card
    // that has shown that number since the feed shipped.
    staleImages: state.cards.staleImages,
    staleSources: staleness.readings.filter((reading) => reading.state === 'stale').length,
    unevaluable: staleness.readings.filter((reading) => reading.state === 'unknown').length,
  };

  return {
    tone: toneFor(triggers, counts),
    counts,
    worst: worstFinding(findings),
    oldest: oldestUnowned(findings, expiredWaivers, now),
    triggers: sortFacts(triggers),
    riders: sortFacts(riders),
    staleness: staleness.readings,
  };
}

/**
 * Precedence: something to act on beats something we cannot see, which beats a trend.
 *
 * WHY an unreadable reading is not simply "act": it is still push-worthy (the channel has to say it),
 * but the card should read as "this cannot be judged" rather than as a finding — an operator who sees
 * "needs attention" beside no finding will look for one that is not there.
 */
function toneFor(triggers: readonly SignalFact[], counts: SignalCounts): SignalTone {
  if (triggers.some((fact) => !fact.key.startsWith('cannot-evaluate:'))) return 'act';
  if (counts.unevaluable > 0) return 'unevaluable';
  if (counts.unwaivedHigh > 0 || counts.expiringWaivers > 0 || counts.agedFindings > 0) return 'watch';
  return 'clear';
}

/**
 * A stable order for the message: the lapsed decision first (it is already failing CI and is the
 * cheapest to settle), then the unwaived criticals, then whatever cannot be seen or is stale. Inside
 * a kind, the oldest fact leads, because it is the one that has been ignored longest.
 */
const KIND_ORDER: Record<SignalFactKind, number> = {
  'waiver-expired': 0,
  'finding-critical': 1,
  staleness: 2,
};

function sortFacts(facts: readonly SignalFact[]): readonly SignalFact[] {
  return [...facts].sort((left, right) => {
    const kind = KIND_ORDER[left.kind] - KIND_ORDER[right.kind];
    if (kind !== 0) return kind;
    return (left.since ?? '').localeCompare(right.since ?? '');
  });
}

/** The most severe unresolved finding; ties go to the one seen first. */
function worstFinding(findings: readonly PatchingFinding[]): SignalLead | null {
  const ranked = [...findings].sort((left, right) => {
    const severity =
      (left.severity === null ? 99 : SEVERITY_ORDER[left.severity]) -
      (right.severity === null ? 99 : SEVERITY_ORDER[right.severity]);
    if (severity !== 0) return severity;
    return left.firstSeen.localeCompare(right.firstSeen);
  });
  const worst = ranked[0];
  if (worst === undefined) return null;
  const waiver =
    worst.waiver.status === 'active'
      ? `waived until ${worst.waiver.reviewBy.slice(0, 10)}`
      : worst.waiver.status === 'expired'
        ? `waiver expired ${worst.waiver.reviewBy.slice(0, 10)}`
        : 'no waiver';
  return {
    label: findingLabel(worst),
    detail: `${worst.severity ?? 'unrated'} · ${waiver}`,
    since: worst.firstSeen,
    ageDays: null,
  };
}

/**
 * The oldest thing nobody owns: an unwaived finding or a lapsed waiver, whichever began earlier.
 *
 * WHY unowned and not simply oldest: a finding under a current waiver has been decided about, so it
 * is not "the oldest problem" — naming it would tell the operator to look at the one item that is
 * already handled.
 */
function oldestUnowned(
  findings: readonly PatchingFinding[],
  expiredWaivers: readonly { readonly id: number; readonly source: string; readonly match: string; readonly reviewBy: string }[],
  now: Date,
): SignalLead | null {
  const candidates: SignalLead[] = [
    ...findings
      .filter((finding) => finding.waiver.status === 'none')
      .map((finding) => ({
        label: findingLabel(finding),
        detail: `${finding.severity ?? 'unrated'} · no waiver · first seen ${finding.firstSeen.slice(0, 10)}`,
        since: finding.firstSeen,
        ageDays: ageDays(finding.firstSeen, now),
      })),
    ...expiredWaivers.map((waiver) => ({
      label: `${waiver.source} waiver ${waiver.match}`,
      detail: `review was due ${waiver.reviewBy.slice(0, 10)}`,
      since: waiver.reviewBy,
      ageDays: ageDays(waiver.reviewBy, now),
    })),
  ];
  const sorted = candidates.sort((left, right) => (left.since ?? '').localeCompare(right.since ?? ''));
  return sorted[0] ?? null;
}

/** What the last message said, and when. Written only when a message actually left. */
export interface PageRecord {
  readonly notifiedAt: string;
  readonly keys: readonly string[];
}

export type NotifyReason = 'send' | 'nothing-to-say' | 'unchanged' | 'rate-limited';

export interface NotifyPlan {
  readonly send: boolean;
  readonly reason: NotifyReason;
  /** Every fact the message would carry — the full current state, not only the new lines. */
  readonly facts: readonly SignalFact[];
  /** The facts the last message did not carry; these are what make it worth sending. */
  readonly fresh: readonly SignalFact[];
  readonly mention: boolean;
  readonly title: string;
  readonly body: string;
}

/**
 * Decides whether this tick says anything, and what.
 *
 * WHY the diff and the floor are separate: the diff makes a *repeat* impossible (the same lapsed
 * waiver is in the last message's keys, so it is not fresh), and the floor makes a *storm*
 * impossible (a fact that flaps is new again after a partial push, and the floor is what stops it
 * becoming one message a minute). Only a send writes a {@link PageRecord}, so a suppressed fact is
 * never marked as delivered.
 */
export function planNotification(
  digest: SecurityDigest,
  last: PageRecord | null,
  now: Date,
): NotifyPlan {
  const facts = digest.triggers;
  const known = new Set(last?.keys ?? []);
  const fresh = facts.filter((fact) => !known.has(fact.key));
  const title = `Security: ${String(facts.length)} item${facts.length === 1 ? '' : 's'} need attention`;

  if (facts.length === 0) {
    return { send: false, reason: 'nothing-to-say', facts, fresh, mention: false, title, body: '' };
  }
  if (fresh.length === 0) {
    return { send: false, reason: 'unchanged', facts, fresh, mention: false, title, body: '' };
  }
  if (last !== null && now.getTime() - new Date(last.notifiedAt).getTime() < SIGNAL_RULES.minIntervalMs) {
    return { send: false, reason: 'rate-limited', facts, fresh, mention: false, title, body: '' };
  }
  return {
    send: true,
    reason: 'send',
    facts,
    fresh,
    mention: facts.some((fact) => fact.kind === 'staleness' || fact.kind === 'finding-critical'),
    title,
    body: renderMessage(digest, fresh),
  };
}

/**
 * The message body: the full push set, then the riders as one counted line.
 *
 * WHY the full set and not only the new lines: a message that names one fact leaves the operator
 * guessing whether the backup is still broken. Riders ride because they are the context that makes
 * the page worth opening — they are not the reason the message exists.
 */
export function renderMessage(digest: SecurityDigest, fresh: readonly SignalFact[]): string {
  const lines: string[] = [];
  const shown = digest.triggers.slice(0, SIGNAL_RULES.maxLines);
  for (const fact of shown) lines.push(`• ${fact.detail}`);
  const hidden = digest.triggers.length - shown.length;
  if (hidden > 0) lines.push(`• …and ${String(hidden)} more on the Patching page`);

  const riderCounts = new Map<string, number>();
  for (const rider of digest.riders) {
    const label = riderLabel(rider);
    riderCounts.set(label, (riderCounts.get(label) ?? 0) + 1);
  }
  if (riderCounts.size > 0) {
    const summary = [...riderCounts.entries()].map(([label, count]) => `${String(count)} ${label}`).join(' · ');
    lines.push(`Also on the page: ${summary}.`);
  }
  if (fresh.length > 0) {
    lines.push(`${String(fresh.length)} of these ${fresh.length === 1 ? 'is' : 'are'} new since the last message.`);
  }
  return lines.join('\n');
}

function riderLabel(rider: SignalFact): string {
  if (rider.key.startsWith('high:')) return 'unwaived HIGH';
  if (rider.key.startsWith('aged:')) return `older than ${String(SIGNAL_RULES.findingAgeDays)} days`;
  if (rider.key.startsWith('image:')) return 'stale image';
  return 'expiring waiver';
}
